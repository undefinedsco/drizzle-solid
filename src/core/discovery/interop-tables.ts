import { solidSchema, string, uri, id } from '../pod-table';
import { INTEROP, UDFS } from './interop-types';

const ns = { prefix: 'interop', uri: INTEROP.NS };

// Registry Set (Entry point from Profile)
export const registrySetSchema = solidSchema('registrySet', {
  id: id(),
  hasDataRegistry: uri('hasDataRegistry').array().predicate(INTEROP.hasDataRegistry),
  hasAgentRegistry: uri('hasAgentRegistry').array().predicate('http://www.w3.org/ns/solid/interop#hasAgentRegistry'),
}, {
  type: INTEROP.RegistrySet,
  namespace: ns
});

// Data Registry (Contains Data Registrations)
export const dataRegistrySchema = solidSchema('dataRegistry', {
  id: id(),
  hasDataRegistration: uri('hasDataRegistration').array().predicate(INTEROP.hasDataRegistration),
}, {
  type: INTEROP.DataRegistry,
  namespace: ns
});

// Data Registration (Links to actual data location)
export const dataRegistrationSchema = solidSchema('dataRegistration', {
  id: id(),
  registeredShapeTree: uri('registeredShapeTree').predicate(INTEROP.registeredShapeTree),
  registeredBy: uri('registeredBy').predicate(INTEROP.registeredBy),
  registeredAt: string('registeredAt').predicate('http://www.w3.org/ns/solid/interop#registeredAt'),
  // UDFS extension: subject template for data instances
  subjectTemplate: string('subjectTemplate').predicate(UDFS.subjectTemplate),
}, {
  type: INTEROP.DataRegistration,
  namespace: ns
});

// Application Registration (For an App to find its grants)
export const applicationRegistrationSchema = solidSchema('applicationRegistration', {
  id: id(),
  registeredAgent: uri('registeredAgent').predicate('http://www.w3.org/ns/solid/interop#registeredAgent'),
  hasAccessGrant: uri('hasAccessGrant').predicate(INTEROP.hasAccessGrant),
}, {
  type: INTEROP.ApplicationRegistration,
  namespace: ns
});

// Access Grant (Group of Data Grants)
export const accessGrantSchema = solidSchema('accessGrant', {
  id: id(),
  grantedBy: uri('grantedBy').predicate('http://www.w3.org/ns/solid/interop#grantedBy'),
  grantedAt: string('grantedAt').predicate('http://www.w3.org/ns/solid/interop#grantedAt'),
  grantee: uri('grantee').predicate('http://www.w3.org/ns/solid/interop#grantee'),
  hasDataGrant: uri('hasDataGrant').array().predicate(INTEROP.hasDataGrant),
}, {
  type: INTEROP.AccessGrant,
  namespace: ns
});

// Data Grant (Specific access to data)
export const dataGrantSchema = solidSchema('dataGrant', {
  id: id(),
  registeredShapeTree: uri('registeredShapeTree').predicate(INTEROP.registeredShapeTree),
  hasDataRegistration: uri('hasDataRegistration').predicate(INTEROP.hasDataRegistration),
  scopeOfGrant: uri('scopeOfGrant').predicate(INTEROP.scopeOfGrant),
  accessMode: uri('accessMode').array().predicate('http://www.w3.org/ns/solid/interop#accessMode'),
  dataOwner: uri('dataOwner').predicate(INTEROP.dataOwner),
}, {
  type: INTEROP.DataGrant,
  namespace: ns
});
