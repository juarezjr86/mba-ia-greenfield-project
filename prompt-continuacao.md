# Prompt de continuação — StreamTube Fase 03 (implementação, SI-03.16 pronta, 2026-10-19)

Cole este arquivo inteiro como primeira mensagem de uma nova sessão (após `/clear`). Ele
substitui a versão anterior (pré-implementação, 2026-10-18). Leia antes de agir, nesta ordem:
a memória `projeto-streamtube-fase03-ambiente`, `docs/phases/phase-03-videos/progress.md`
(fonte do estado e das decisões por SI), `licoes.md` (L-21..L-28 são as mais recentes) e, para
a SI em curso, o bloco dela em `docs/phases/phase-03-videos/phase-03-videos.md` e o spec em
`nestjs-project/specs/`.

## 1. Persona e escopo

Você é o assistente do aluno-maestro no desafio "Continuando o StreamTube com IA" (MBA),
Fase 03: upload e processamento de vídeos, **só backend** (`nestjs-project/`), Compose e
artefatos em `docs/`. Decisão técnica da fase é do aluno (EXC-01): você apresenta opções,
trade-offs e recomendação e para. Fora do escopo: frontend, Fase 04, editar
`docs/project-plan.md`, subir o dev server, commit/push por conta própria.

## 2. Objetivo

Concluir as SIs 03.17 a 03.20 do plano, uma por vez e em sequência, cada uma com a suíte
verde antes da próxima, e deixar a Fase 03 pronta para a Definition of Done.

## 3. Entradas (estado verificado em 2026-10-19)

- Branch `feature/phase-03-videos`. **16/20 SIs concluídas.** Commits: SI-03.14 `0a945da`,
  SI-03.15 `6ab7c00`. **SI-03.16 pronta e NÃO commitada** (`getStreamUrl`,
  `FileNotAvailableException`, `PresignedUrlResponseDto`, `test/videos-stream.e2e-spec.ts`),
  junto com as atualizações de `progress.md`, `phase-03-videos.md`, `licoes.md` e este arquivo.
- Estado dos testes: 42 suítes / 399 testes; e2e 9 suítes / 119 (sempre
  `npm run test:e2e -- --runInBand`); `tsc` 0; lint 0 erros (1 aviso antigo em
  `auth.service.integration-spec.ts:473`); build ok.
- Ambiente: Docker Desktop ligado; infra no ar (db, mailpit, storage `pgsty/silo`, redis) e o
  serviço `video-worker` também (estado normal; usa o prefixo de fila `bull` e o bucket de
  dev, as suítes usam prefixo e bucket próprios). Reconfira com `docker compose ps` antes de
  confiar.
- Regra de commit do aluno: ele commita a SI N quando pede junto do "siga com a SI N+1". Nunca
  por conta própria. Mensagem no padrão `SI-03.N: <resumo>` com as linhas de atribuição do
  system-reminder.
- Próximas SIs (detalhe no plano):
  - **SI-03.17** `GET /videos/:id/download`: mesmo mecanismo do stream, resposta
    `{ url, expires_in, filename }` (`original_filename`); `StorageService.presignGet` já
    aceita `downloadFilename` (gera `filename*=UTF-8''...`). Reutilize `getVisibleVideo`, o
    `PresignedUrlResponseDto` (estenda com `filename` só para esta rota) e a ordem
    "visibilidade primeiro, `draft` → 409 depois" (L-21). Mesmo padrão de teste do stream,
    incluindo o `content-disposition` real devolvido pelo storage.
  - **SI-03.18** `GET /videos/:id/thumbnail`: mesma regra de acesso; 409
    `THUMBNAIL_NOT_AVAILABLE` quando `thumbnail_key` é nulo.
  - **SI-03.19** fluxo ponta a ponta + exportação OpenAPI + smoke de 10 GB (risco alto:
    advisor antes; o 10 GB é o critério de reprova "arquivo de 10GB travando a API").
    Registrar também se `ensureBucket()` passa a rodar na subida (hoje só `npm run
    storage:init`).
  - **SI-03.20** atualizar o `CLAUDE.md` da raiz e o de `nestjs-project/` a partir do código
    real (módulo, endpoints, fila/worker, storage, serviços do Compose, variáveis); corrigir
    só o que o código sustenta, inclusive "Message Queue (TBD)" e "`next-frontend/` — not yet
    initialized".
- Lacunas conhecidas, registradas no `progress.md` e não codadas: job estourando
  `maxStalledCount` deixa o vídeo em `processing` (SI-03.13); vídeo `failed` por objeto sumido
  responde 200 com URL que dá 404 no storage (SI-03.16); checksum da URL de parte só passa
  porque o silo o ignora (SI-03.5).

## 4. Saída (passos, nesta ordem)

1. Ler a memória, `progress.md` e `licoes.md`; `git status` e `docker compose ps`.
2. Se o aluno pedir, commitar a SI-03.16 (sem push) e seguir com a SI-03.17.
3. Para cada SI: ecoar o contrato de 7 tópicos; ler o bloco do plano, o spec e o código que ela
   reutiliza; **advisor antes** nas SIs de risco (03.19) e no fim se algo surpreender; implementar
   com testes na camada certa (unit, integração com serviços reais, e2e a partir do spec).
4. Definition of Done de cada SI: `docker compose exec -T nestjs-api npm test -- --runInBand`,
   `npm run test:e2e -- --runInBand`, `npx tsc --noEmit`, `npm run lint`, `npm run build`,
   `git status` só com os arquivos pretendidos; formatar com
   `docker compose exec -T nestjs-api npx prettier --write <arquivos .ts>`.
5. Atualizar `progress.md` (status, testes, observações, assunções), marcar a SI no plano e a
   memória; parar sem commitar.
6. Ao fechar a SI-03.20, rodar a revisão final da fase (suíte completa, `tsc`, lint, build,
   `CLAUDE.md` coerente com o código) e apresentar a análise de lacunas item a item.

## 5. Critérios de aceite

- Cada SI cumpre os critérios do plano com teste que os prova (Range 206 com `Content-Range`
  exato, 404 sem vazar existência, allowlist de campos, etc.).
- Suíte completa e e2e verdes, `tsc` 0, lint sem erros, build ok, Jest termina sozinho (sem
  `--forceExit`).
- Nenhum arquivo, símbolo ou API citado sem confirmação (Read/Grep; context7 ou os `.d.ts`
  instalados para APIs de biblioteca).

## 6. Ambiguidade e assunções declaradas

- Assunção: a regra de visibilidade de download e thumbnail é a mesma do stream (o plano diz
  "same access rule"); divergir disso é `BLOQUEANTE`.
- `BLOQUEANTE` se aparecer: decisão técnica nova (peça `/research` ou `/decide`), divergência
  entre plano e código, ou ação irreversível/externa.

## 7. Proibições

- Commit, push ou merge sem pedido explícito; commit na `main`; subir o dev server; `Agent`
  solto; mock do que roda de verdade no Compose; `localhost` entre serviços (exceção só para
  `S3_PUBLIC_ENDPOINT`); `.env` em comando Bash/PowerShell (o hook bloqueia: use Read/Edit);
  `npx prettier --write src` sem filtro; `--forceExit`; gravar segredo; resolver decisão
  técnica pelo aluno.
