import { ASTToSPARQLConverter } from '../ast-to-sparql';
import { ComunicaSPARQLExecutor, SolidSPARQLExecutor } from '../sparql-executor';
import { TypeIndexManager } from '../typeindex-manager';
import { CompositeDiscovery, InteropDiscovery, TypeIndexDiscovery, type DataDiscovery } from '../discovery';
import { DrizzleShapeManager, type ShapeManager } from '../shape';
import { ResourceResolverFactoryImpl } from '../resource-resolver';
import { ExecutionStrategyFactoryImpl } from '../execution';
import { LdpExecutor } from '../execution/ldp-executor';
import { UriResolverImpl } from '../uri';
import type { PodTable } from '../schema';
import type { QueryCondition } from '../query-conditions';
import type { PodRuntime } from '../runtime/pod-runtime';

export interface PodServiceOptions {
  runtime: PodRuntime;
  clientId?: string;
  disableInteropDiscovery?: boolean;
  listContainerResources: (containerUrl: string) => Promise<string[]>;
  findSubjectsForCondition: (
    condition: QueryCondition,
    table: PodTable,
    resourceUrl: string
  ) => Promise<string[]>;
}

export class PodServices {
  private uriResolver: UriResolverImpl;
  private sparqlConverter: ASTToSPARQLConverter;
  private sparqlExecutor: ComunicaSPARQLExecutor;
  private ldpExecutor: LdpExecutor;
  private typeIndexManager: TypeIndexManager;
  private discovery: DataDiscovery;
  private shapeManager: ShapeManager;
  private resolverFactory: ResourceResolverFactoryImpl;
  private strategyFactory: ExecutionStrategyFactoryImpl;

  constructor(options: PodServiceOptions) {
    const runtime = options.runtime;
    const podUrl = runtime.getPodUrl();
    const webId = runtime.getWebId();
    const fetchFn = runtime.getFetch();

    this.uriResolver = new UriResolverImpl(podUrl);

    this.sparqlConverter = new ASTToSPARQLConverter(podUrl, webId, this.uriResolver);
    this.sparqlExecutor = new SolidSPARQLExecutor({
      sources: [podUrl],
      fetch: fetchFn,
      logging: false,
    });

    this.ldpExecutor = new LdpExecutor(this.sparqlExecutor, fetchFn, this.uriResolver);

    this.typeIndexManager = new TypeIndexManager(webId, podUrl, fetchFn);
    const typeIndexDiscovery = new TypeIndexDiscovery(this.typeIndexManager, podUrl, this.uriResolver);
    if (options.disableInteropDiscovery) {
      this.discovery = new CompositeDiscovery([typeIndexDiscovery]);
    } else {
      const interopDiscovery = new InteropDiscovery(webId, fetchFn, options.clientId);
      this.discovery = new CompositeDiscovery([typeIndexDiscovery, interopDiscovery]);
    }

    this.shapeManager = new DrizzleShapeManager(podUrl, fetchFn);
    this.resolverFactory = new ResourceResolverFactoryImpl(podUrl, this.uriResolver);

    this.strategyFactory = new ExecutionStrategyFactoryImpl({
      sparqlExecutor: this.sparqlExecutor,
      sparqlConverter: this.sparqlConverter,
      sessionFetch: fetchFn,
      podUrl,
      ldpExecutor: this.ldpExecutor,
      uriResolver: this.uriResolver,
      getResolver: (table) => this.resolverFactory.getResolver(table),
      listContainerResources: options.listContainerResources,
      findSubjectsForCondition: options.findSubjectsForCondition,
    });
  }

  getUriResolver(): UriResolverImpl {
    return this.uriResolver;
  }

  getSparqlConverter(): ASTToSPARQLConverter {
    return this.sparqlConverter;
  }

  getSparqlExecutor(): ComunicaSPARQLExecutor {
    return this.sparqlExecutor;
  }

  getLdpExecutor(): LdpExecutor {
    return this.ldpExecutor;
  }

  getTypeIndexManager(): TypeIndexManager {
    return this.typeIndexManager;
  }

  getDiscovery(): DataDiscovery {
    return this.discovery;
  }

  getShapeManager(): ShapeManager {
    return this.shapeManager;
  }

  getResolverFactory(): ResourceResolverFactoryImpl {
    return this.resolverFactory;
  }

  getStrategyFactory(): ExecutionStrategyFactoryImpl {
    return this.strategyFactory;
  }
}
