# Arquitetura — Rota Express 3.0

## Visão Geral

O Rota Express 3.0 utiliza uma arquitetura full-stack em TypeScript com separação clara entre **Núcleo de Domínio**, **Adaptadores de Provedores Externos**, **Camada de Persistência Híbrida (IndexedDB + Cloud Firestore)** e **Interface Mobile-First PWA**.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Frontend React 19 + Vite PWA + Tailwind CSS v4 + Zustand                │
│  ├── InteractiveMap (@vis.gl/react-google-maps + Route.computeRoutes)   │
│  ├── RouteWizardView (SheetJS/PapaParse + Mapeamento + Pin Correction)  │
│  ├── RoutesAndDriverView (Modo Motorista + Reotimização + 2ª Tentativa) │
│  ├── PackagesAndLoadingView (Smart Loading + QR + Scanner ZXing)        │
│  ├── FinancialAndReportsView (BRL + Recharts + Exportação Segura)       │
│  └── AssistantDrawer (Gemini Function Calling + Voz Web Speech)         │
├─────────────────────────────────────────────────────────────────────────┤
│ Persistência Offline-First                                              │
│  ├── IndexedDB (`src/lib/offlineDb.ts`) — Workspaces 'real' vs 'demo'   │
│  └── Firebase SDK (`src/lib/firebase.ts`) — Auth + Cloud Firestore      │
├─────────────────────────────────────────────────────────────────────────┤
│ Backend Express (`server.ts`, Porta 3000)                               │
│  ├── /api/health, /api/config/public, /api/usage                        │
│  ├── /api/integrations/status, /api/integrations/test                   │
│  ├── /api/imports/suggest-mapping (Gemini gemini-4-hydrogen)            │
│  ├── /api/addresses/geocode (Proxy Google Geocoding deduplicado)        │
│  ├── /api/routes/optimize & /api/routes/compare (Routes API + Local)    │
│  └── /api/assistant (Gemini Function Calling com 10 ferramentas)        │
└─────────────────────────────────────────────────────────────────────────┘
```

## Núcleo de Domínio (`src/domain/`)

- `address.ts`: Normalizador de endereços brasileiros (Quadra, Lote, Setor, S/N, Rural), guarda de CEP com zeros à esquerda, detector de inversão lat/lng, classificador de confiança e chave de deduplicação.
- `spreadsheet.ts`: Parser XLSX/XLS/CSV sem execução de fórmulas, mapeador determinístico + assinatura estrutural de templates e exportador com escape contra CSV/Excel Formula Injection.
- `grouping.ts`: Agrupamento seguro por endereço normalizado + janela de tempo, derivação determinística do status da parada a partir dos pacotes, mesclagem e desagrupamento manual.
- `optimizer.ts`: Motor combinatório real (Multi-Start NN, Cheapest Insertion, Asymmetric 2-Opt, Or-Opt, Relocate, Swap), avaliação de custo composto (`km * custo_km + tempo * custo_hora + penalidade_janela`), validador de integridade da solução e Inteligência de Segunda Tentativa.
- `financial.ts`: Consolidador operacional em BRL com divisão segura (`safeDivide`) e prevenção de dupla contagem entre combustível/manutenção reais e estimados.
- `providers.ts`: Contratos hexagonais para desacoplar provedores de geocodificação, matriz viária, otimização e IA.

## Invariantes Arquiteturais

1. **Independência de carga física**: `DeliveryPackage.physicalLocationId` nunca é sobrescrito ao criar novas versões de rota (`RouteVersion`).
2. **Isolamento real vs demonstração**: O IndexedDB armazena chaves separadas (`'real'` e `'demo'`) e rotas `isDemo: true` nunca são sincronizadas com o Cloud Firestore.
3. **Transparência de cálculo**: Toda métrica carrega `isRoadDistanceReal` para informar claramente quando os valores vêm da malha rodoviária real vs aproximação geométrica local (1,28×).
4. **Governança de custos**: Rate limiting por rota, circuit breaker por provedor, deduplicação de geocodificação, teto de matriz N×N e monitoramento em `/api/usage`.
