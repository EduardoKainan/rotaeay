# Esquema de Banco de Dados — Rota Express 3.0

O Rota Express 3.0 opera com persistência híbrida: **IndexedDB local** (offline-first, isolando `'real'` vs `'demo'`) e **Cloud Firestore** (sincronização autenticada na nuvem).

## 1. Coleções Cloud Firestore (`firebase-blueprint.json` + `firestore.rules`)

| Coleção | Chave | Descrição & Isolamento |
| --- | --- | --- |
| `/users/{userId}` | `uid` | Perfil do entregador (`name`, `email`, `role`, `organizationId`, `city`, `state`, `preferredNavigator`). Leitura/escrita restrita ao próprio titular; papel `role` não auto-escalável. |
| `/organizations/{orgId}` | `orgId` | Estrutura multi-tenant preparada para planos SaaS (`free`, `professional`, `premium`, `enterprise`). |
| `/vehicles/{vehicleId}` | `vehicleId` | Veículos do usuário com consumo (km/L), preço do combustível, manutenção/km, custo/hora e capacidade (peso/pacotes). Isolado por `ownerId`. |
| `/import_templates/{templateId}` | `templateId` | Modelos aprendidos de mapeamento de planilhas identificados por `structureSignature`. Isolado por `userId`. |
| `/routes/{routeId}` | `routeId` | Cabeçalho de rotas planejadas, ativas e concluídas com `origin` e `metrics` em mapas nativos. Rotas `finished`/`cancelled` são imutáveis. |
| `/route_stops/{stopId}` | `stopId` | Paradas físicas agrupadas vinculadas a `routeId` e `routeVersion`. |
| `/packages/{packageId}` | `packageId` | Pacotes com `trackingCode` (string preservando zeros à esquerda), `status`, `physicalLocationId` (independente da sequência da rota) e `locationConfidence`. |
| `/delivery_events/{eventId}` | `eventId` | Trilha imutável (append-only) de auditoria de entregas, tentativas frustradas, adiamentos e conferências de carga. Atualização e exclusão bloqueadas nas regras. |
| `/financial_entries/{entryId}` | `entryId` | Receitas e despesas reais ou estimadas (`type`, `category`, `amount`, `isEstimated`, `date`). |
| `/favorite_addresses/{addressId}` | `addressId` | Endereços favoritos (CD, base de partida, casa) com coordenadas opcionais. |
| `/api_usage/{usageId}` | `usageId` | Registros imutáveis de consumo e custo estimado de APIs externas. |

## 2. Armazenamento Local IndexedDB (`rota_express_v3`)

- **Object Store `workspaces`**:
  - Chave `'real'`: rotas, pacotes, veículos, eventos, financeiro, templates e favoritos da conta real.
  - Chave `'demo'`: dados fictícios de Goiânia estritamente isolados, podendo ser reiniciados ou encerrados sem tocar nos dados reais.
- **Object Store `sync_queue`**:
  - Fila idempotente de `DeliveryEvent` registrados offline (chave `eventId`). Ao reconectar à internet, os eventos pendentes são enviados ao Cloud Firestore e removidos da fila após confirmação.
