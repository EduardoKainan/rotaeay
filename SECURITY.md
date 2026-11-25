# Segurança & Privacidade (LGPD) — Rota Express 3.0

## Controles Implementados

1. **Segredos apenas no Backend**:
   - `GEMINI_API_KEY` e `GOOGLE_MAPS_SERVER_KEY` são lidas exclusivamente em `server.ts` (`process.env`).
   - Nenhum segredo é exposto no bundle do frontend ou nos endpoints públicos (`/api/config/public` retorna apenas a chave pública de navegador destinada à Maps JS API).
2. **Isolamento de Dados e Regras Firestore (`firestore.rules`)**:
   - Acesso padrão negado (`allow read, write: if false`).
   - Isolamento estrito por titular autenticado com e-mail verificado (`request.auth.uid`).
   - Validação de tipos, tamanhos, domínios (`enum`), timestamps do servidor (`request.time`) e bloqueio de auto-escalação de papel (`role`).
   - Trilha de auditoria (`delivery_events`) e uso de API (`api_usage`) em modo *append-only* (imutáveis).
   - Validado via `@firebase/eslint-plugin-security-rules` (`npm run lint:rules`) e suíte estrutural (`firestore.rules.test.ts`).
3. **Proteção de Planilhas (Upload & Exportação)**:
   - Fórmulas em arquivos `.xlsx`/`.xls`/`.csv` importados nunca são executadas (`cellFormula: false` + sanitização de células).
   - Exportações `.csv` e `.xlsx` escapam automaticamente payloads iniciados por `=`, `+`, `-`, `@`, `\t` ou `\r` (preservando coordenadas negativas válidas) para impedir CSV/Excel Formula Injection.
4. **Proteção de Endpoints & SSRF**:
   - Validação de entrada com `zod` em todos os endpoints `POST` do backend.
   - Rate limiting por rota/IP e circuit breaker para falhas repetidas em APIs externas.
   - Bloqueio SSRF em `OSRM_BASE_URL` (rejeita `localhost`, `127.0.0.1`, `169.254.169.254`, faixas RFC1918 privadas e o servidor público de demonstração OSRM).
5. **Privacidade e LGPD**:
   - Ao solicitar sugestão de mapeamento de colunas via Gemini, apenas os nomes das colunas e amostras anonimizadas (números mascarados) são enviados — nomes/telefones reais dos destinatários não são enviados.
   - O usuário pode exportar todos os seus dados em JSON ou excluir sua conta em **Mais > Privacidade & LGPD**.

> **Recomendação antes de compartilhamento amplo**: revise e endureça `firestore.rules` conforme o modelo final de permissões da sua organização/transportadora.
