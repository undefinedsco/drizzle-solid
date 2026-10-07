import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Parser } from 'n3';
import { drizzle, podTable, string, object, StrictIfMatchN3Backend } from '../../../src';
import { buildTestPodUrl, createTestSession, ensureContainer } from './helpers';
import type { Session } from '@inrupt/solid-client-authn-node';

const folder=`/conditional-writes-${Date.now()}/`;
const base=buildTestPodUrl(folder);
const ns='https://example.test/conditional#';
const table=podTable('ConditionalRecord',{id:string('id').primaryKey().predicate(`${ns}id`),metadata:object('metadata').predicate(`${ns}metadata`)},{type:`${ns}Record`,base:`${base}records.ttl`,namespace:{prefix:'c',uri:ns},subjectTemplate:'#{id}',autoRegister:false});
function patch(doc:string,old:string,next:string):string{return `@prefix solid:<http://www.w3.org/ns/solid/terms#>. _:patch a solid:InsertDeletePatch; solid:deletes { <${doc}#one> <${ns}value> "${old}". }; solid:inserts { <${doc}#one> <${ns}value> "${next}". }; solid:where { <${doc}#one> <${ns}value> "${old}". }.`;}
describe('real CSS conditional resource mutations',()=>{
 let session:Session;const documents=new Set<string>();
 async function seed(name:string,body:string){const doc=`${base}${name}.ttl`;documents.add(doc);const r=await session.fetch(doc,{method:'PUT',headers:{'Content-Type':'text/turtle'},body});expect(r.ok).toBe(true);return doc;}
 beforeAll(async()=>{session=await createTestSession();await ensureContainer(session,folder);},120000);
 afterAll(async()=>{for(const doc of documents)await session.fetch(doc,{method:'DELETE'});});
 it('actual producer rejects every stale strong version, including equivalent-result competitor',async()=>{
  const doc=await seed('protocol',`<${base}protocol.ttl#one> <${ns}value> "old".`);
  const initial=await session.fetch(doc);const etag=initial.headers.get('etag');expect(etag).toMatch(/^"[^"\r\n]+"$/);await initial.text();
  const request={method:'PATCH',headers:{'Content-Type':'text/n3','If-Match':etag!},body:patch(doc,'old','current')};
  const first=await session.fetch(doc,request);const firstBody=await first.text();expect(first.ok, `${first.status} ${firstBody}`).toBe(true);
  const changed=await session.fetch(doc);const changedBody=await changed.text();console.info('OWN protocol versions',{original:etag,after:changed.headers.get('etag'),body:changedBody,request:request.body,firstStatus:first.status});
  const stale=await session.fetch(doc,{...request,body:patch(doc,'current','current')});const staleBody=await stale.text();expect(stale.status,staleBody).toBe(412);
  const get=await session.fetch(doc);const fresh=get.headers.get('etag')!;await get.text();
  const failure=await session.fetch(doc,{method:'PATCH',headers:{'Content-Type':'text/n3','If-Match':fresh},body:patch(doc,'absent','corrupt')});expect([409,412]).toContain(failure.status);
  const after=await session.fetch(doc);const values=new Parser({baseIRI:doc}).parse(await after.text());expect(values.some(q=>q.object.value==='current')).toBe(true);expect(values.some(q=>q.object.value==='corrupt')).toBe(false);
 });
 it('explicit conformance refuses the measured fast-version collision backend',async()=>{
  const probeDocument=`${base}owned-probe-${Date.now()}.ttl`;
  await expect(StrictIfMatchN3Backend.qualify({fetch:session.fetch,scope:base,probeDocument})).rejects.toThrow(/version/);
  // Rejected backend cannot safely prove conditional cleanup. Keep this owned probe for review.
  expect((await session.fetch(probeDocument)).ok).toBe(true);
 });
 it('unqualified exact selected properties do not mutate the real Pod',async()=>{
  const doc=await seed('records',`<${base}records.ttl#one> a <${ns}Record>; <${ns}id> "one"; <${ns}metadata> <${base}records.ttl#one-metadata>; <${ns}unknown> "bonjour"@fr.
   <${base}records.ttl#one-metadata> <${ns}memberRoles> "owner"; <${ns}protocols> ${JSON.stringify(JSON.stringify({matrix:{eventId:'old'},other:41}))}^^<http://www.w3.org/2001/XMLSchema#json>.`);
  const db=drizzle(session,{resourcePreparation:'off'});
  const before=await session.fetch(doc);expect(before.ok).toBe(true);await before.text();
  const snapshot=await db.readResourceSnapshot(table,`${doc}#one`);
  const result=await db.update(table).set({metadata:{protocols:{matrix:{eventId:'current'}}}}).whereByIri(`${doc}#one`).executeConditional({snapshot});
  expect(result.status).toBe('unsupported');
  const after=await session.fetch(doc);const facts=new Parser({baseIRI:doc}).parse(await after.text());
  expect(facts.some(q=>q.predicate.value===`${ns}memberRoles`&&q.object.value==='owner')).toBe(true);
  expect(facts.some(q=>q.predicate.value===`${ns}unknown`&&q.object.termType==='Literal'&&q.object.language==='fr')).toBe(true);
  const protocols=facts.find(q=>q.predicate.value===`${ns}protocols`)!;expect(JSON.parse(protocols.object.value)).toEqual({matrix:{eventId:'old'},other:41});
 });
});
