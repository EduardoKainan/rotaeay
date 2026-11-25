# Configuração de APIs & Variáveis de Ambiente — Rota Express 3.0

Consulte `.env.example` para a lista completa de variáveis. **Nunca salve chaves secretas no código-fonte ou no repositório Git.**

## 1. Firebase (Auth + Cloud Firestore)

Provisionado no projeto `gen-lang-client-0016415458` com banco `ai-studio-bdf5d59b-84a8-48d8-8f54-ba9d933bb267` e configuração gerada em `firebase-applet-config.json`.
- **Login com Google**: habilitado via `signInWithPopup`.
- **E-mail e Senha**: caso deseje permitir cadastro por e-mail/senha além do Google, ative o provedor *Email/Password* no Firebase Console > Authentication > Sign-in method.
- **Regras de Segurança**: definidas em `firestore.rules` e auditáveis com `npm run lint:rules`.

## 2. Google Maps Platform

### Chave de Demonstração (Atual)
O projeto utiliza uma chave de demonstração provisionada pelo AI Studio para desenvolvimento. Quando o limite de cota for atingido, o aplicativo exibe um banner orientativo com o link oficial para migração.

### Chave Própria para Produção
1. Crie/selecione um projeto no [Google Cloud Console](https://console.cloud.google.com/).
2. Habilite as APIs:
   - **Maps JavaScript API** (mapa interativo, Advanced Markers e `Route.computeRoutes`)
   - **Geocoding API** (conversão deduplicada de endereços sem coordenadas via backend)
   - **Routes API** (matriz rodoviária real de distância/duração com trânsito via backend)
3. Crie **duas chaves separadas** e aplique [restrições de chave](https://developers.google.com/maps/api-security-best-practices?utm_campaign=gmp_mcp_codeassist_v1_aistudio):
   - `VITE_GOOGLE_MAPS_API_KEY`: restrita por **HTTP Referrer** (domínio do app) e apenas para **Maps JavaScript API**.
   - `GOOGLE_MAPS_SERVER_KEY`: restrita por **IP do servidor** (ou backend privado) e apenas para **Geocoding API** e **Routes API**.
4. Configure alertas de orçamento no Google Cloud Billing e ajuste `DAILY_API_LIMIT` e `MONTHLY_API_BUDGET` no ambiente.

## 3. Google Gemini API (`GEMINI_API_KEY`)

Usada exclusivamente no backend (`server.ts`) com o modelo `gemini-4-hydrogen` para:
- `/api/assistant` (Assistente de Rota com Function Calling)
- `/api/imports/suggest-mapping` (sugestão opcional de mapeamento de cabeçalhos anonimizados)

Configure `GEMINI_API_KEY` em **Settings > Secrets** no AI Studio ou nas variáveis do servidor de produção.

## 4. Provedores Opcionais (Enterprise / Auto-hospedados)

- **Google Route Optimization API**: exige `GOOGLE_CLOUD_PROJECT_ID`, `ROUTE_OPTIMIZATION_ENABLED=true` e credenciais OAuth/ADC com billing ativo.
- **OSRM Próprio**: configure `ROUTING_PROVIDER=osrm` e `OSRM_BASE_URL=https://seu-servidor-osrm.com`. Endereços privados/loopback e o servidor público `router.project-osrm.org` são bloqueados automaticamente.
- **OR-Tools Próprio**: configure `ORTOOLS_SERVICE_URL=https://seu-servico-ortools.com`.

## 5. Diagnóstico em Tempo Real

Acesse **Mais > Integrações & API** dentro do aplicativo para visualizar o status dos 9 serviços, acompanhar consumo/orçamento e disparar testes manuais de conexão.
