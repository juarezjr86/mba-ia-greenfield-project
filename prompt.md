# Prompt de iniciação — Desafio "Continuando o StreamTube com IA" (Fase 03)

Cole este arquivo inteiro como primeira mensagem de uma nova conversa. É um prompt de
**início** (o projeto ainda não começou): não há histórico de revisões nem estado de git
a retomar. Leia também `CLAUDE.md` desta pasta antes de qualquer ação.

---

## 1. O que é este projeto

Desafio prático de MBA em Desenvolvimento de Sistemas com Ênfase em IA. Continuar o
StreamTube (plataforma de vídeos tipo YouTube) implementando a **Fase 03 — Upload e
Processamento de Vídeos**, conduzida por IA com o workflow de planejamento do projeto
(research → plan-context → plan-validate → plan-resolve → plan-build → implement).
Entrega: API, worker, infraestrutura (Compose) e artefatos do processo. **Sem frontend.**

- Diretório local: `C:\Users\juare\OneDrive\Fontes\projetos-claude\Continuando o StreamTube com IA`
- Repositório base: https://github.com/devfullcycle/mba-ia-greenfield-project
- Fork público (destino do push): `A CONFIRMAR` com o aluno (padrão provável:
  `https://github.com/juarezjr86/mba-ia-greenfield-project`)

## 2. Regras (detalhe em `CLAUDE.md`; só seguir)

- **Não inventar:** tudo rastreável ao plano ou ao código; sem origem = hipótese marcada.
- **Workflow sem atalho:** as skills têm `disable-model-invocation: true`, então o aluno
  digita `/research`, `/plan-context`, `/plan-validate`, `/plan-resolve`, `/plan-build`,
  `/implement`. Você orienta qual é o próximo comando; não pula estágio.
- **Decisões são do aluno:** apresente opções, trade-offs e recomendação, e pare (EXC-01).
- **Definition of Done:** suítes verdes + `npx tsc --noEmit` (0) + `npm run lint`.
- **Git Flow:** `feature/phase-03-videos` a partir de `dev`; nunca `main`; commit/push só a
  pedido explícito.
- **Docker:** host = nome do serviço do Compose; npm/npx/testes dentro do container.

## 3. Estado inicial (verificado em 2026-10-10 no repositório base; reverifique)

- Pasta local ainda **sem fork clonado** (só `CLAUDE.md` e `prompt.md`).
- Base tem as branches `main` e `dev` (e outras de fases anteriores). Fases 01 e 02
  (backend e frontend) fechadas; pastas de fase em `docs/phases/`.
- Backend em `nestjs-project/`; `compose.yaml` atual tem só `nestjs-api` (3000), `db`
  (PostgreSQL 17) e `mailpit`. Faltam: storage, fila e worker (você constrói).
- `.mcp.json` do repositório declara só o servidor `postgres`; **context7 não está nele**.
  O enunciado exige context7: confirme que o MCP está disponível na sessão (`/mcp`) e avise
  o aluno se faltar, antes de seguir.
- `CLAUDE.md` upstream da raiz está parcialmente defasado ("Message Queue (TBD)",
  "next-frontend not yet initialized"): corrigir só no fechamento, com base no código.
- Skills do workflow em `.claude/skills/` (`research`, `plan-pipeline`, `plan-context`,
  `plan-validate`, `plan-resolve`, `plan-build`, `plan-test-specs`, `implement`), regras em
  `.claude/rules/`, sub-agents de leitura em `.claude/agents/` (das skills, não seus).

## 4. Primeira ação ao iniciar

1. Pedir ao aluno a URL do fork e a confirmação de que ele existe (fork público).
2. Clonar o fork em pasta temporária ao lado (o clone não entra em pasta não vazia) e mover
   o conteúdo para esta pasta, **preservando** `prompt.md` e `CLAUDE.md`. Mesclar o
   `CLAUDE.md`: este bloco no topo, o upstream da raiz preservado integralmente abaixo.
3. `git checkout dev` e `git checkout -b feature/phase-03-videos` (sem commit sem pedido).
4. Subir só a infraestrutura em `nestjs-project/` (`docker compose up -d`), confirmar com
   `docker compose ps` e `docker compose exec db pg_isready -U streamtube`; instalar
   dependências no container; rodar migrations e a suíte atual. **Baseline verde antes de
   qualquer mudança**; vermelho = pare e relate.
5. Ler `.claude/skills/plan-pipeline/SKILL.md` e `docs/phases/phase-02-auth/` (formato da
   fase) e `docs/diagrams/software-arch.mermaid`.
6. Entregar ao aluno o mapa do plano e indicar o primeiro comando: `/research`.

## 5. Onde estão as coisas

| O quê | Onde |
| --- | --- |
| Plano do projeto (Fase 03) | `docs/project-plan.md` |
| Arquitetura-alvo | `docs/diagrams/software-arch.mermaid` |
| Decisões técnicas (existentes) | `docs/decisions/technical-decisions-*.md` |
| Formato de pasta de fase | `docs/phases/phase-02-auth/` |
| Formato de `library-refs.md` | `docs/phases/phase-02-auth-frontend/library-refs.md` |
| Saída desta fase | `docs/decisions/technical-decisions-phase-03-videos.md`, `docs/phases/phase-03-videos/` |
| Módulo de referência de forma | `nestjs-project/src/auth/` |
| Migrations / Compose | `nestjs-project/src/database/migrations/`, `nestjs-project/compose.yaml` |

## 6. Armadilhas conhecidas

- Fila é a única decisão de stack genuinamente aberta; storage é S3/MinIO por definição.
- Upload de 10GB é decisão de arquitetura: o arquivo não passa pela API.
- `.env` lido por Compose e `dotenv`: valores com `<`, `>`, `|`, `&` ou espaço vão entre aspas.
- Asset não-TypeScript em runtime precisa constar em `nest-cli.json` (`assets`).
- `node_modules` num bind mount dentro do OneDrive pode pesar a sincronização (risco
  observado, não medido): avisar o aluno antes de instalar dependências.

## 7. Não fazer

- Não editar `next-frontend/` nem implementar interface de vídeo.
- Não implementar antes de `validation.md` em `clean`.
- Não simular fila, worker ou storage que dá para rodar no Compose.
- Não commitar, fazer push ou abrir PR sem pedido explícito.
