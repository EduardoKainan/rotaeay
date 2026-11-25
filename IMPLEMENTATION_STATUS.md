# Status de Implementação — Rota Express 3.0

Este documento descreve com transparência o que está **funcional agora**, o que depende de **chaves/configurações externas** e quais **limitações** existem nesta versão.

## Funcional Agora (Validado Localmente)

- **Importação XLSX, XLS e CSV real** (UTF-8 e Windows-1252, múltiplas abas, preservação de zeros à esquerda, bloqueio de fórmulas, resumo completo de rastreabilidade).
- **Normalização de endereços brasileiros** e detecção automática de latitude/longitude invertidas.
- **Agrupamento de pacotes em paradas** com manutenção do status individual, desagrupamento e mesclagem manual.
- **Motor combinatório de otimização** (Multi-Start NN + Cheapest Insertion + Asymmetric 2-Opt + Or-Opt + Relocate + Swap + paradas fixas + rotas abertas/fechadas + validação de solução).
- **Organização física de carga (Smart Loading)** independente da sequência da rota, com zonas personalizáveis, geração de etiquetas QR imprimíveis e exportação XLSX/CSV.
- **Modo Motorista completo**: navegação externa Google Maps e Waze, ligação, WhatsApp, entrega individual/parcial/lote, 9 motivos de tentativa frustrada, reotimização dinâmica com comparativo antes/depois e Inteligência de Segunda Tentativa.
- **Scanner de etiquetas** (câmera com ZXing + entrada manual + alerta sonoro opcional).
- **Financeiro operacional em BRL e Relatórios** com Recharts, exportação CSV/XLSX protegida contra injeção de fórmulas e impressão PDF.
- **PWA Offline-First**: Manifesto, ícones 192/512/maskable, Service Worker Workbox, botão de instalação (Android/Desktop + guia iOS) e persistência isolada em IndexedDB (`real` vs `demo`).
- **Modo Demonstração Goiânia** isolado com bases de 10, 50, 150 e 500 pacotes fictícios e download de planilha modelo.
- **Firebase Auth + Cloud Firestore** provisionados no projeto `gen-lang-client-0016415458`, com `firestore.rules` auditadas (0 erros ESLint) e publicadas.

## Dependente de Chaves / Configuração Externa

- **Google Maps JavaScript API / Geocoding API / Routes API**: provisionada via chave de demonstração no AI Studio (`demo_project`). Sujeita a limites de cota da chave de demonstração; para uso comercial contínuo, configure chave própria no Google Cloud com restrições de domínio/API.
- **Google Gemini API (`gemini-4-hydrogen`)**: o Assistente de Rota (Function Calling) e a sugestão de mapeamento de colunas dependem de `GEMINI_API_KEY` configurada em Secrets.
- **Google Route Optimization API (VRP Enterprise)**: opcional; requer projeto Google Cloud com billing, API habilitada e autenticação OAuth/ADC (`GOOGLE_CLOUD_PROJECT_ID` e `ROUTE_OPTIMIZATION_ENABLED=true`). Quando ausente, o sistema opera com Google Routes API + motor heurístico local.
- **OSRM / OR-Tools auto-hospedados**: provedores alternativos opcionais; exigem `OSRM_BASE_URL` ou `ORTOOLS_SERVICE_URL` apontando para infraestrutura própria (o servidor público de demo do OSRM é bloqueado por segurança).

## Limitações Conhecidas e Próximos Passos para Produção

- **Confirmação oficial em marketplaces**: o Rota Express não realiza baixa automática nos servidores privados da Shopee, Mercado Livre ou Amazon; o motorista deve confirmar a entrega no aplicativo oficial da plataforma quando exigido.
- **Mapas offline**: dados de paradas, pacotes e eventos funcionam offline via IndexedDB, mas tiles interativos do Google Maps exigem conexão ativa (navegação curva a curva offline depende de mapas baixados no Google Maps/Waze).
- **Escala da matriz Google Routes**: por governança de custos, a consulta N×N completa à Google Routes API é limitada a até 20 paradas por chamada; rotas maiores utilizam o motor heurístico local sinalizado como estimativa geométrica.
- **Prontidão comercial**: esta versão está pronta para testes operacionais e validação de campo; antes de distribuição comercial ampla, recomenda-se revisar `firestore.rules`, configurar faturamento próprio no Google Cloud, habilitar monitoramento externo (Sentry/Cloud Logging) e validar autenticação por e-mail/senha no console Firebase.
