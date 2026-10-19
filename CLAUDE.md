# CLAUDE.md — Projeto Acadêmico: Continuando o StreamTube com IA (Fase 03)

> Bloco de governança da sessão. Ao clonar o fork, este bloco entra no TOPO do `CLAUDE.md`
> da raiz do fork, com o conteúdo upstream preservado integralmente logo abaixo (nunca
> sobrescrever). O `nestjs-project/CLAUDE.md` do fork não é tocado por este bloco.

## Contexto acadêmico

Entrega de um desafio do MBA em Desenvolvimento de Sistemas com Ênfase em IA. Diferente de
um projeto só documental, **aqui o código é o entregável**: implementar a **Fase 03 —
Upload e Processamento de Vídeos** do StreamTube, no fork público de
`devfullcycle/mba-ia-greenfield-project`, dando continuidade às Fases 01 e 02 (já fechadas).

- Escopo: **só backend** (`nestjs-project/`) + infraestrutura (Compose) + artefatos de
  planejamento em `docs/`. O frontend (`next-frontend/`) existe e **não** faz parte da fase.
- A IA (Claude Code) é a ferramenta principal e obrigatória; o aluno é o maestro: conduz o
  workflow na ordem, revisa criticamente, refina prompts, mantém os artefatos coerentes.
- A presença da IA precisa ser observável no repositório: decisões, planejamento, plano e
  progresso saem do fluxo, não de edição manual solta.
- Regras globais de ADVPL/TLPP/Protheus e a regra CP1252 **não se aplicam**: este projeto é
  Node.js/TypeScript em UTF-8.

## Regra fundamental: não inventar

Todo requisito, decisão ou comportamento registrado em artefato precisa ter origem
rastreável: o plano (`docs/project-plan.md`, documento de decisões, plano da fase) ou o
código (caminho real). Sem origem: classificar como "Não informado", "Questão em aberto",
"Hipótese", "Inferência" ou "Necessita validação".

- Antes de citar arquivo, classe ou símbolo: confirmar com Read/Glob/Grep.
- Antes de usar API de biblioteca: consultar a doc oficial via **context7** na versão
  instalada (`package.json`); divergência de versão é sinalizada, não resolvida em silêncio.
- Documentação que cita arquivo ou comportamento inexistente reprova.

## Fontes oficiais (precedência)

1. Enunciado do desafio (colado pelo aluno; se for salvo em arquivo, registrar o caminho aqui):
   critérios de aceite e "reprova automática".
2. `docs/project-plan.md` (seção Fase 03) e `docs/diagrams/software-arch.mermaid`.
3. `CLAUDE.md` do fork (raiz e `nestjs-project/`), `.claude/rules/`, `.claude/skills/`.
4. Código existente em `nestjs-project/src/` (`auth/` é a referência de forma).
5. `docs/phases/phase-02-auth/` (formato da pasta de fase) e
   `docs/phases/phase-02-auth-frontend/library-refs.md` (formato do `library-refs.md`).

## Workflow obrigatório (não pular, não inverter)

| # | Estágio | Comando | Artefato |
| --- | --- | --- | --- |
| 1 | research | `/research` | `docs/decisions/technical-decisions-phase-03-videos.md` |
| 2 | plan-context | `/plan-context` | `docs/phases/phase-03-videos/context.md` |
| 3 | plan-validate | `/plan-validate` | `validation.md` (status `clean`) |
| 4 | plan-resolve | `/plan-resolve` | decisões/contexto atualizados + `library-refs.md` |
| 5 | plan-build | `/plan-build` | `phase-03-videos.md` (SI-03.x + Technical Specs + Dependency Map + Deliverables) |
| 6 | plan-test-specs (opcional) | `/plan-test-specs` | specs de teste |
| 7 | implement | `/implement` | código + `progress.md` |

- As skills do pipeline (`research`, `plan-context`, `plan-validate`, `plan-resolve`,
  `plan-build`, `plan-test-specs`, `implement`, `decide`) têm
  `disable-model-invocation: false` por **EXC-02**; as demais skills de `.claude/skills/`
  mantêm `true`. Mesmo assim o aluno conduz a ordem: a IA só invoca uma etapa quando ela é
  pedida e, ao terminar, diz qual é a próxima em vez de encadeá-la. Argumentos seguem
  `.claude/skills/plan-pipeline/SKILL.md`.
- Itere validate ↔ resolve até `validation.md` fechar em `clean`. Só então `plan-build`;
  só depois `implement`.
- Os sub-agents de `.claude/agents/` pertencem às skills: não invocar diretamente.
- Slug da Fase 03: o documento de decisões se chama `technical-decisions-phase-03-videos.md`
  (nome do enunciado), então a regra literal das skills (`phase-NN-{slug}`) daria
  `phase-03-phase-03-videos`. Em todos os estágios use `docs/phases/phase-03-videos/` e o nome
  `phase-03-videos` (`context.md`, `validation.md`, `library-refs.md`, `phase-03-videos.md`,
  `progress.md`), como nas Fases 01 e 02. Resolvido em 2026-10-10 (OQ-7).
- Technical Specs obrigatórias no plano: Data Model, API Contracts, Authorization Matrix,
  Error Catalog e Events/Messages (por causa da fila).
- `implement`: SI a SI, **em sequência** (nunca em paralelo), só avança com a suíte do SI
  verde; `progress.md` atualizado (status + testes por SI), como na Fase 02.

## Advisor (Opus) — quando consultar

A sessão roda com Sonnet como coordenador e a tool `advisor` (Opus, revisor independente). A
tool não tem parâmetros e recebe a conversa inteira. Não é delegação (como `SendMessage`):
não passa pela `Workflow` e não executa nem escreve nada. Papel: refutar, não decidir.

Cada chamada reenvia a conversa inteira (custo em tokens) e o advisor tende a concordar com o
raciocínio que viu: use pouco, em pontos fixos (cerca de 5 a 6 chamadas na fase).

| Momento | Chamar |
| --- | --- |
| `plan-build`, antes de fixar a decomposição em SIs e o Dependency Map | Sim: erro de desenho aqui é o mais barato de corrigir |
| `plan-build`, com o plano gravado em disco, antes de declará-lo pronto | Sim, e some a revisão cega abaixo: Technical Specs completas, ordem das SIs, cobertura dos 12 TDs |
| `implement`, antes de SI de risco: multipart/URL pré-assinada, retry e idempotência do worker, Range/206, transação, autorização | Sim |
| `implement`, 2ª falha seguida na mesma coisa ou abordagem que não converge | Sim |
| `implement`, antes de fechar SI de risco, com suíte verde e `progress.md` gravados | Opcional |
| `research`, `plan-context`, `plan-validate`, `plan-resolve` | Não, salvo issue que altere desenho ou Technical Spec |
| SI mecânica (DTO, migration simples, config), ler, rodar suíte, corrigir lint, CLAUDE.md final | Não |

Regras de uso:

- Chamar **antes** do trabalho substancial (escrever, fixar interpretação) e **no fim**, com o
  entregável já gravado em disco. Em tarefa curta e reativa, uma chamada basta ou nenhuma.
- Orientação (ler arquivos, Grep, context7) vem antes da chamada; não consulte no escuro.
- O advisor vê o raciocínio do coordenador, então não é revisão cega. No gate do plano
  (`phase-03-videos.md`), que pode reprovar a entrega, faça também a revisão independente da
  árvore global: Opus via `Workflow`, briefing só com os artefatos (`context.md`, decisões,
  plano) e pedido de refutação, sem o veredito do coordenador.
- Retorno útil: crítica, severidade, evidência `arquivo:linha`. O coordenador confere cada
  crítica na fonte (Read/Grep/context7) antes de acatar; conselho não é verificação.
- Conflito com evidência já coletada: não troque em silêncio; uma segunda chamada expõe o
  conflito ("achei X, você sugere Y, o que desempata?").
- Fora de escopo para o advisor: aceite, símbolo/API (a fonte é código real ou context7),
  regra de negócio e decisão técnica da fase. Pela EXC-01 o parecer do advisor entra como
  insumo nas opções e trade-offs apresentados ao aluno, que continua decidindo.
- Registrar em `licoes.md` quando o parecer mudar uma decisão ou desenho.

## Escopo da Fase 03 (de `docs/project-plan.md`)

Object storage (vídeos e thumbnails) · fila de processamento + worker · upload de até 10GB
sem travar a API · pré-cadastro do vídeo como rascunho ao iniciar o upload · duração e
metadados extraídos automaticamente · thumbnail a partir de um frame · URL única por vídeo ·
streaming sem download completo · download pelo usuário.

Decisões em aberto para o research: **tecnologia de fila** (TBD no plano; principal decisão
de stack), estratégia de upload de 10GB (nunca passar o arquivo inteiro pela API), execução
do worker e FFmpeg/ffprobe, URL única e streaming (Range/206), ciclo de status e falha.
O object storage **não** é escolha: S3-compatível, MinIO local em Docker; decide-se como usá-lo.

## Regras do enunciado e do fork

- **Docker:** host sempre o nome do serviço do Compose (`db`, `nestjs-api`, …), nunca
  `localhost`/`127.0.0.1`.
- **Comandos:** `npm`/`npx`/`node`/`tsc`/testes rodam **dentro do container**
  (`docker compose exec nestjs-api …`). Integração e e2e com `--runInBand`. Não subir o dev
  server sem pedido explícito; processo que não termina vai em background.
- **Testes:** sufixos `*.spec.ts` (unit, sem I/O), `*.integration-spec.ts` (banco/serviços
  reais), `*.e2e-spec.ts` (supertest). Não mockar o que roda de verdade no Compose.
- **Definition of Done:** suíte relevante + suíte completa verdes, `npx tsc --noEmit` com
  código 0, `npm run lint` passando. Dívida de compilação não é adiada.
- **Git Flow:** branch `feature/phase-03-videos` a partir de `dev`; volta para `dev`;
  **nunca commit na `main`**. Commit/push só a pedido explícito do aluno.
- **Escopo:** uma coisa por vez; achado fora de escopo vira nota, não mudança.
- **Camadas:** seguir `.claude/rules/` (controller/service/repository, DTOs, entidades,
  migrations versionadas, transações). Reusar guard JWT global, filtro de exceções de
  domínio, ValidationPipe, rate limiting; somar fase, não reescrever as anteriores.

## Reprova automática (checklist de bloqueio)

- Implementar sem research/planejamento/artefatos · plano sem SIs ou sem Technical Specs ·
  `validation.md` que não fecha em `clean`.
- Arquivo de 10GB passando pela API de forma que trave o sistema.
- Fila, worker ou storage ausentes ou simulados no Compose.
- `tsc` com erro, lint quebrado, suíte vermelha.
- Commit direto na `main`.
- `CLAUDE.md` inconsistente com o código.

## Atualização final do CLAUDE.md

Só depois de a fase implementada, a partir do **código real**: seção de vídeos (módulo,
endpoints, fila/worker, storage, serviços do Compose, variáveis de ambiente). Atualizar os
dois arquivos (raiz e `nestjs-project/`). Ao fazê-lo, conferir as pendências upstream
observadas em 2026-10-10 (fila ainda marcada como não decidida e `next-frontend/` marcado
como não inicializado, embora o diretório exista); corrigir só o que o código sustenta.
Feito na SI-03.20 (2026-10-19): ambas as linhas corrigidas e a seção de vídeos escrita.

## Exceção ao global

EXC-01 · global "em portão, siga a opção recomendada" · decisão técnica da fase (research,
`plan-resolve`) é do aluno: a IA apresenta opções, trade-offs e recomendação, e **para**
para ele decidir · critério de aceite exige decisões justificadas pelo aluno-maestro ·
validade 2026-12-31 · usuário (proposta, a ratificar).

EXC-02 · "as skills têm `disable-model-invocation: true`: o aluno digita o comando e a IA
não se auto-dispara" (workflow obrigatório, abaixo) · as 8 skills do pipeline (`research`,
`plan-context`, `plan-validate`, `plan-resolve`, `plan-build`, `plan-test-specs`,
`implement`, `decide`) passam a `false` · pedido do aluno em 2026-10-18; motivo não
informado · limites que continuam valendo: ordem do workflow, portões de decisão da EXC-01
(a IA para e o aluno decide) e uma etapa por vez, sem encadear a seguinte · validade
2026-12-31 · usuário (2026-10-18).

## Revisão antes de declarar qualquer artefato concluído

1. Toda seção exigida pelo formato da fase está presente.
2. Todo requisito/decisão tem origem rastreável (plano ou código).
3. Nenhum arquivo, serviço ou símbolo citado é inexistente.
4. Artefatos coerentes entre si (decisões ↔ context ↔ plano ↔ progress ↔ código).
5. `verification-before-completion`: rodar a verificação e mostrar a saída antes de afirmar
   que passou.

## Comportamento esperado da IA (modo professor)

Para cada etapa relevante: (1) explicação simples do que se faz e por quê; (2) camada
técnica — conceito, aplicação no projeto, trade-offs, alternativas. Registrar aprendizado em
`licoes.md` (nunca apagar lições anteriores). Não gerar artefato final sem antes mapear e
apresentar o plano ao aluno. Markdown puro, tabelas para conteúdo tabular, sem emojis no
conteúdo técnico, links relativos entre documentos.


---

<!-- Conteúdo upstream (devfullcycle/mba-ia-greenfield-project) preservado integralmente abaixo -->

# CLAUDE.md

## Project Overview

StreamTube — a video sharing platform (YouTube-like). Users can upload, manage, and publish videos. Anonymous users can watch freely; social features (comments, subscriptions, likes) require authentication.

More info in the project overview: [docs/project-plan.md](docs/project-plan.md)

## Repository Structure

This is a monorepo with two main areas:

- `nestjs-project/` — Backend API (NestJS 11, TypeScript, Express). Contains modules for users, channels, videos, comments, etc.
- `docs/` — Project documentation, architecture diagrams, and planning.
- `next-frontend/` — Next.js app (initialized, with its own `CLAUDE.md` and `compose.yaml`); outside the scope of Phase 03.

## Architecture (C4 Container Diagram)

See `docs/diagrams/software-arch.mermaid` for the full diagram. Key containers:

- **Frontend** (Next.js) → calls API via REST, streams from Object Storage
- **API** (Nest.js) → business rules, auth, reads/writes DB, uploads to storage, publishes jobs to queue, sends emails
- **Video Worker** (FFmpeg) → consumes jobs from queue, processes videos, updates DB and storage
- **Database** (PostgreSQL) → users, channels, videos, comments, likes
- **Object Storage** (S3-compatible, served by `pgsty/silo` pinned at `RELEASE.2026-10-18T00-00-00Z`, a community fork that replaces MinIO because the official `minio/minio` image is no longer distributed) → video files and thumbnails
- **Message Queue** (BullMQ on Redis 7.4.11, `noeviction`, append-only file on the `redis_data` volume) → video processing job queue (`video-processing`)
- **Email Service** (SMTP) → account confirmation and password recovery

## Phase 03 — Video upload and processing (implemented)

Endpoints, environment variables and commands: [nestjs-project/CLAUDE.md](nestjs-project/CLAUDE.md) → "Videos, Queue and Worker". Plan and progress: `docs/phases/phase-03-videos/`.

- **Compose services** (`nestjs-project/compose.yaml`): `nestjs-api`, `video-worker` (same image, entrypoint `src/worker.ts`, no published port), `db`, `mailpit`, `storage` (`pgsty/silo`; port 9000 S3, 9001 console), `redis`. `ffmpeg` and `ffprobe` come from `nestjs-project/Dockerfile.dev`.
- **Flow:** the file never passes through the API. `POST /videos` creates a `draft` and starts a multipart upload; the client sends each part straight to a presigned storage URL; `POST /videos/:id/upload/complete` finalizes it and enqueues a `process-video` job; the worker extracts metadata and a JPEG thumbnail and moves the video to `ready` (or `failed`).
- **Playback:** `stream`, `download` and `thumbnail` return JSON with a short-lived presigned GET URL; storage answers `Range` with `206`.

## Docker Networking

This project runs entirely in Docker containers. When configuring connections between services (database, cache, queue, etc.), **always use the Docker Compose service name** as the host — never `localhost` or `127.0.0.1`.

Inside a container, `localhost` refers to the container itself, not the host machine or other containers. Services communicate through the Docker Compose network using their service names (e.g., `db`, `nestjs-api`).

- **Correct:** `DB_HOST=db` (the Compose service name)
- **Wrong:** `DB_HOST=localhost`

This applies to all environment variables, configuration files, and code that references service hosts.

**One exception:** `S3_PUBLIC_ENDPOINT` (`http://localhost:9000` in the example environment file). Presigned URLs are signed for the address the client outside Docker (browser, `curl` on the host) reaches, so it is the only host that is not a Compose service name. Every service-to-service address (`S3_ENDPOINT=http://storage:9000`, `REDIS_HOST=redis`, `DB_HOST=db`) keeps the service name. Tests that fetch a presigned URL from inside the `nestjs-api` container override it with `http://storage:9000`.

## Working Principles

- **Single Responsibility:** each module, service, and function should have a clear, focused responsibility. Re-evaluate adherence at every step — when a module starts owning logic or entities that are not its own (e.g., a service creating an entity from another domain), extract it immediately into the proper module instead of deferring to a later corrective task.
- **Type Safety:** Strict TypeScript usage across all layers.
- **Testing:** Strong emphasis on pyramid testing at all levels to ensure reliability and maintainability.
- **Code Quality:** Use ESLint and Prettier for consistent code style. Code reviews should focus on readability, maintainability, and adherence to best practices.
- **Documentation:** Comprehensive docs for architecture, setup, and troubleshooting in `docs/`.

## Definition of Done (Technical)

A change is only considered complete when **all** of the following pass:

1. The relevant test suite passes (unit + integration + e2e affected by the change).
2. The full test suite passes before finishing the task.
3. TypeScript compiles cleanly: `npx tsc --noEmit` exits with code 0. Compilation errors must never be left as debt for future tasks.
4. Lint passes: `npm run lint`.

If any of these fails, the task is not done — fix the underlying issue before declaring completion.


## Git Conventions

- **Main branch:** `main` — never commit directly to it
- Branches: `feature/*`, `bugfix/*`, `hotfix/*`, `docs/*`
- **Commits:** short, descriptive messages focused on the "why" of the change
- **Workflow:** Git Flow conventions. Two long-lived branches:
  - `main` — stable, production-ready code 
  - `dev` — integration branch; all feature/bugfix/hotfix branches start from `dev` and merge back into `dev`
  - When `dev` is stable, it is merged into `main`

## Testing Policy

Every change must be tested. During development, run only the tests related to the modified code. Before finishing, always run the full test suite to ensure nothing is broken.

## Scope Limits

- Work on **one feature, fix, or refactoring at a time** — do not mix scopes
- Do not include cosmetic changes (formatting, renaming) alongside functional changes
- If something out of scope comes up during work, note it as a separate task instead of acting on it
- Focus on the defined scope for each task to ensure clarity and maintainability of the codebase.
- If you identify a necessary change that is out of scope, create a new issue or task for it instead of including it in the current work.

## Agent Skill Usage

When working on any task (planning, implementing, debugging, refactoring, 
reviewing, etc.), decompose the request into its underlying subtasks and 
concerns, then identify which available skills match any of them and activate 
those skills.

## Library Documentation Lookup

Before implementing any feature, you MUST use the **context7** MCP tool to look up the relevant library APIs and official documentation.

Always:

- Check the installed library version in the project manifest
- Retrieve the corresponding documentation using context7
- Cross-reference APIs to avoid deprecated or incompatible patterns
- Follow the official documentation over training data

Skip documentation lookup only for trivial operations such as:

- Variable declarations
- Basic control flow
- Simple CRUD using established project patterns

If a library is involved and there is uncertainty, documentation lookup is mandatory.
If the documentation returned does not match the installed version, flag the discrepancy before proceeding.