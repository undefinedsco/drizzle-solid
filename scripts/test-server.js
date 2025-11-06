#!/usr/bin/env node

const express = require('express');
const cors = require('cors');

const app = express();
const port = 3000;

// 启用 CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'DPop']
}));

app.use(express.json());

// 根路径
app.get('/', (req, res) => {
  res.set({
    'Content-Type': 'text/turtle',
    'Link': '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"'
  });
  res.send(`
@prefix ldp: <http://www.w3.org/ns/ldp#> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .

<> a ldp:BasicContainer, ldp:Container ;
   ldp:contains <profile/>, <data/> .
`);
});

// Profile 路径
app.get('/profile/card', (req, res) => {
  res.set('Content-Type', 'text/turtle');
  res.send(`
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
@prefix solid: <http://www.w3.org/ns/solid/terms#> .

<#me> a foaf:Person ;
      foaf:name "Test User" ;
      solid:oidcIssuer <http://localhost:3000> .
`);
});

// Data 容器
app.get('/data/', (req, res) => {
  res.set({
    'Content-Type': 'text/turtle',
    'Link': '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"'
  });
  res.send(`
@prefix ldp: <http://www.w3.org/ns/ldp#> .

<> a ldp:BasicContainer, ldp:Container .
`);
});

// SPARQL 端点
app.post('/sparql', (req, res) => {
  console.log('SPARQL Query received:', req.body);
  
  // 返回空结果集
  res.json({
    head: { vars: ["id", "webId", "name", "email", "isVerified", "lastLoginAt"] },
    results: { bindings: [] }
  });
});

// 处理所有其他请求
app.use('*', (req, res) => {
  console.log(`${req.method} ${req.originalUrl}`);
  res.status(200).send('OK');
});

app.listen(port, () => {
  console.log(`🚀 测试 Solid 服务器运行在 http://localhost:${port}`);
  console.log('✅ 服务器已准备好接收请求');
});

// 优雅关闭
process.on('SIGINT', () => {
  console.log('\n🛑 正在停止测试服务器...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 正在停止测试服务器...');
  process.exit(0);
});