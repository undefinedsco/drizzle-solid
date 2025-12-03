/**
 * Solid Application Interoperability (SAI) 相关的常量和类型定义
 */

export const INTEROP = {
  NS: 'http://www.w3.org/ns/solid/interop#',
  
  // Classes
  ApplicationRegistration: 'http://www.w3.org/ns/solid/interop#ApplicationRegistration',
  DataRegistration: 'http://www.w3.org/ns/solid/interop#DataRegistration',
  AccessGrant: 'http://www.w3.org/ns/solid/interop#AccessGrant',
  DataGrant: 'http://www.w3.org/ns/solid/interop#DataGrant',
  RegistrySet: 'http://www.w3.org/ns/solid/interop#RegistrySet',
  DataRegistry: 'http://www.w3.org/ns/solid/interop#DataRegistry',

  // Properties
  hasRegistrySet: 'http://www.w3.org/ns/solid/interop#hasRegistrySet',
  hasDataRegistry: 'http://www.w3.org/ns/solid/interop#hasDataRegistry',
  hasDataRegistration: 'http://www.w3.org/ns/solid/interop#hasDataRegistration',
  registeredShapeTree: 'http://www.w3.org/ns/solid/interop#registeredShapeTree',
  registeredBy: 'http://www.w3.org/ns/solid/interop#registeredBy',
  hasAccessGrant: 'http://www.w3.org/ns/solid/interop#hasAccessGrant',
  hasDataGrant: 'http://www.w3.org/ns/solid/interop#hasDataGrant',
  scopeOfGrant: 'http://www.w3.org/ns/solid/interop#scopeOfGrant',
  dataOwner: 'http://www.w3.org/ns/solid/interop#dataOwner',
  registeredShapeTreeProp: 'http://www.w3.org/ns/solid/interop#registeredShapeTree', // duplicated for clarity
} as const;

export const SHAPETREES = {
  NS: 'http://www.w3.org/ns/shapetrees#',
  ShapeTree: 'http://www.w3.org/ns/shapetrees#ShapeTree',
  expectsType: 'http://www.w3.org/ns/shapetrees#expectsType',
  shape: 'http://www.w3.org/ns/shapetrees#shape',
} as const;
