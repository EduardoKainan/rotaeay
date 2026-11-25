# Rota Express 3.0 — Operação Last-Mile Inteligente (pt-BR)

Aplicativo Progressive Web App (PWA) full-stack mobile-first desenvolvido para entregadores autônomos e pequenas transportadoras no Brasil (Shopee, Mercado Livre, Amazon e entregas particulares).

## O que o sistema entrega hoje

- **Importação real de planilhas (`.xlsx`, `.xls`, `.csv`)**: leitura via SheetJS e PapaParse com suporte a UTF-8/Windows-1252, seleção de abas, preservação de zeros à esquerda em códigos de rastreio e CEPs, proteção contra injeção de fórmulas na importação e exportação, mapeamento determinístico + templates salvos por assinatura estrutural e sugestão opcional via Gemini IA (apenas cabeçalhos e amostras anonimizadas).
- **Normalização de endereços brasileiros & Geocodificação deduplicada**: suporte a Rua, Avenida, Quadra, Lote, Setor, Condomínio, Apartamento, Bloco e Zona Rural; detecção de latitude/longitude invertidas; nunca inventa números ou coordenadas; proxy server-side para Google Geocoding API e correção visual de pino arrastável no mapa.
- **Agrupamento seguro em paradas**: agrupa pacotes do mesmo endereço e janela compatível preservando o rastreio e status individual de cada pacote, com opção manual de desagrupar e mesclar.
- **Otimização combinatória real**: motor local com suporte a matrizes assimétricas, Multi-Start Nearest Neighbor, Cheapest Insertion, 2-Opt assimétrico, Or-Opt, Relocate, Swap, penalidades de janela (VRPTW), paradas fixas de início/fim, rotas abertas ou fechadas e integração com Google Routes API (matriz rodoviária real com guarda de cota).
- **Organização física de carga (Smart Loading)**: zonas configuráveis (A–D e caixas/bags próprias), sugestão em ordem reversa de carregamento, etiquetas QR imprimíveis e **independência total da sequência da rota** (reotimizar nunca altera onde o pacote foi guardado).
- **Modo Motorista & Mapa Operacional**: tela de Próxima Entrega com links diretos para Google Maps, Waze, Ligação e WhatsApp, entrega individual ou em lote com confirmação, 9 motivos de tentativa frustrada, reotimização dinâmica com comparativo antes/depois, Inteligência de Segunda Tentativa e mapa interativo (`@vis.gl/react-google-maps`) com Advanced Markers e polilinhas viárias (`Route.computeRoutes`).
- **Scanner de Etiquetas**: leitor de código de barras e QR por câmera (`@zxing/browser`) com entrada manual de fallback e alerta sonoro opcional (nunca marca entregue automaticamente por leitura).
- **Assistente de Rota (Gemini Function Calling)**: consultas reais à rota ativa, pacotes, zonas de carga, 2ª tentativa e financeiro com confirmação explícita antes de alterar a rota.
- **Financeiro Operacional & Relatórios**: apuração em reais (BRL) separando despesas lançadas de custos estimados sem dupla contagem, gráficos Recharts e exportação segura (CSV/XLSX/impressão PDF).
- **Modo Offline (PWA + IndexedDB) & Modo Demonstração Goiânia**: dados salvos localmente com fila de sincronização para Cloud Firestore e ambiente de demonstração isolado (10, 50, 150 ou 500 pacotes fictícios).

## Scripts Principais

```bash
npm run dev          # Inicia Express + Vite na porta 3000
npm run build        # Compila o PWA React/Vite para dist/
npm run start        # Executa o servidor em modo produção
npm test             # Executa testes automatizados (Vitest)
npm run lint         # Valida tipos TypeScript
npm run lint:rules   # Audita firestore.rules com @firebase/eslint-plugin-security-rules
```

## Documentação Complementar

- `ARCHITECTURE.md` — Arquitetura hexagonal, fluxos e camadas.
- `IMPLEMENTATION_STATUS.md` — Estado real e honesto do que funciona agora vs integrações externas opcionais.
- `API_SETUP.md` — Configuração de Firebase, Google Maps Platform, Gemini e provedores opcionais.
- `DATABASE_SCHEMA.md` — Coleções Firestore, IndexedDB offline e invariantes.
- `SECURITY.md` — Regras de segurança, proteção de segredos e LGPD.
- `TESTING.md` — Estratégia e resultados dos testes automatizados.
