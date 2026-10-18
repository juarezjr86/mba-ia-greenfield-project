# Prompt de continuação — StreamTube Fase 03 (pós 4x `/decide` e EXC-02, 2026-10-18)

Cole este arquivo inteiro como primeira mensagem de uma nova sessão (após `/clear`). Ele
substitui a versão anterior (pós `/plan-resolve`, 2026-10-10). Leia antes de agir:
`CLAUDE.md` desta pasta (EXC-01 e EXC-02), `docs/phases/phase-03-videos/phase-03-videos.md`,
`docs/decisions/technical-decisions-phase-03-videos.md` (blocos `Revisions` de TD-02, 04, 05,
09, 12) e `licoes.md` (L-13..16). A memória do projeto (`projeto-streamtube-fase03-ambiente`)
tem o histórico anterior.

## 1. Persona e escopo

Você é o assistente do aluno-maestro no desafio "Continuando o StreamTube com IA" (MBA),
Fase 03: upload e processamento de vídeos, **só backend** (`nestjs-project/`), Compose e
artefatos em `docs/`. Decisão técnica da fase é do aluno (EXC-01): você apresenta opções,
trade-offs e recomendação e para; o aluno pode delegar a escolha à sua recomendação, e isso
vale só para a decisão em curso. Fora do escopo: frontend, Fase 04, commit/push sem pedido,
subir o dev server, editar `docs/project-plan.md`.

## 2. Objetivo

Levar a Fase 03 do plano gravado (20 SIs, `phase-03-videos.md`) até o código implementado,
passando por: contexto e validação atualizados com as Revisions de hoje, specs de teste e
`/implement 03` SI a SI, em sequência, com a suíte do SI verde antes de avançar.

## 3. Entradas (estado verificado em 2026-10-18)

- Branch `feature/phase-03-videos` (a partir de `dev`), **nada commitado**. Alterados nesta
  sessão e não commitados: `docs/decisions/technical-decisions-phase-03-videos.md`,
  `docs/decisions/technical-decisions-phase-02-auth.md`, `CLAUDE.md` (EXC-02) e 8 arquivos
  `.claude/skills/*/SKILL.md`.
- Plano: `docs/phases/phase-03-videos/phase-03-videos.md` com SI-03.1..SI-03.20, Technical
  Specs e Dependency Map; os 8 endpoints têm `Test Specs: pending /plan-test-specs`. Revisão
  cega do Opus já aplicada (L-16: 19 edições, 3 perguntas ao aluno).
- Revisions gravadas hoje (todas 2026-10-18, nenhuma muda a Option):
  - TD-04: `@aws-sdk/lib-storage` fora. A linha `**Libraries:**` do TD-04 **continua**
    listando `lib-storage`; só a Revision a supera.
  - TD-02 e TD-05: sem endpoint de abort; upload não concluído fica em `draft`.
  - TD-09: `@OptionalAuth()`, 401 em token inválido, 404 oculta não-`ready`, resposta JSON
    `{ url, expires_in }`, 409 `VIDEO_FILE_NOT_AVAILABLE` para o dono em `draft`, 409
    `THUMBNAIL_NOT_AVAILABLE` com `thumbnail_key` nulo. Refina a regra "dono em qualquer
    status" de 2026-10-10.
  - TD-12: "SI-03.0" virou SI-03.1 (migrations spec repetível) e SI-03.2 (lint).
  - `phase-02-auth` TD-08: o `ThrottlerGuard` é `APP_GUARD` global (10 req/60 s, conferido em
    `auth.module.ts:29-35`); a Fase 03 sobrescreve com `@Throttle` por controller
    (`VIDEOS_THROTTLE_LIMIT`, `VIDEOS_THROTTLE_TTL_MS`). O rationale do 4b diz "motivo não
    registrado".
- **Defasados em relação ao documento de decisões:** `context.md` e `library-refs.md` (citam
  `lib-storage`; `library-refs.md` tem 3 menções). `validation.md` também cita `lib-storage` e
  "SI-03.0".
- **Texto do plano ainda desatualizado:** SI-03.4, ação 1, diz que a Revision do TD-04 é
  "follow-up outside this plan"; SI-03.10 diz "not yet recorded in the decisions document" para
  a exclusão do abort. Ambas já estão gravadas.
- EXC-02 (nova, em `CLAUDE.md`): as skills `research`, `plan-context`, `plan-validate`,
  `plan-resolve`, `plan-build`, `plan-test-specs`, `implement` e `decide` estão com
  `disable-model-invocation: false` (conferido por grep). Valem a partir desta sessão nova.
  Motivo "não informado". Validade 2026-12-31. EXC-01 continua "a ratificar".
- Ambiente (verificado só em 2026-10-10; reconfira antes de confiar): containers
  `nestjs-project-nestjs-api-1`, `-db-1`, `-mailpit-1`; baseline `tsc` 0, 23 suítes/144 testes,
  `npm run lint` com 150 erros e 40 avisos (o SI-03.2 paga isso). `npm test -- --runInBand` uma
  vez por schema virgem; reset `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`. Comandos
  com caminho de container vão pelo PowerShell.

## 4. Saída (passos, nesta ordem)

1. Reconferir o estado com `git status` e `grep disable-model-invocation .claude/skills` (8 em
   `false`). Se a EXC-02 não estiver valendo na sessão, dizer qual comando o aluno digita.
2. `/plan-context 03` e depois `/plan-validate 03`. Esperado: `context.md` refeito com as
   Revisions. Se `validation.md` sair `dirty`, apresentar as issues e parar para o aluno;
   `/plan-resolve 03` só então. Se rodar `/plan-resolve`, conferir que `library-refs.md` não
   traz `lib-storage` de volta (a linha `**Libraries:**` do TD-04 ainda a lista).
3. Atualizar `phase-03-videos.md` onde o plano ficou defasado (SI-03.4 ação 1, SI-03.10) e
   conferir se o `plan-build` exige o plano "fresh" frente aos `sources_mtime`; isso não foi
   verificado: ler o preflight do `plan-build` antes de supor. Pedir `/plan-build 03` (modo
   append) só se o preflight exigir.
4. `/plan-test-specs 03`.
5. Antes de `/implement 03`, opcional: advisor sobre o plano gravado (CLAUDE.md pede a revisão
   cega só no gate do plano, já feita). Chamar o advisor antes de SI de risco (multipart,
   retry/idempotência do worker, Range/206, transação, autorização).
6. `/implement 03`, SI a SI, em sequência, com `progress.md` atualizado. A ordem de dependência
   do plano começa em SI-03.1 (migrations spec) e SI-03.2 (lint).
7. Registrar em `licoes.md` (L-17 em diante, nunca apagar) o que mudou desenho hoje: a
   divergência do throttle global e a EXC-02; atualizar a memória do projeto.

## 5. Critérios de aceite

- `context.md` e `validation.md` coerentes com o documento de decisões (sem `lib-storage` e
  sem "SI-03.0" como pendência); `validation.md` em `clean`.
- Texto do plano sem as duas frases desatualizadas do item 3.
- Cada SI do `/implement` termina com a suíte relevante verde; Definition of Done da fase:
  suíte completa verde, `npx tsc --noEmit` com código 0, `npm run lint` passando.
- Nenhum arquivo, símbolo ou API citado sem confirmação (Read/Glob/Grep; context7 na versão
  instalada).

## 6. Ambiguidade e assunções declaradas

- A EXC-02 foi escrita por mim com três limites que o aluno não pediu: manter a ordem do
  workflow, parar nos portões da EXC-01 e fazer uma etapa por vez. Se o aluno discordar, ele
  ajusta o texto.
- O rationale do throttle ficou "motivo não registrado" de propósito. Não invente um.
- `BLOQUEANTE` se aparecer: decisão técnica nova (peça `/research` ou `/decide`), divergência
  entre documento e código, ou ação irreversível/externa.

## 7. Proibições

- Preencher `Decision` ou resolver issue pelo aluno; pular estágio ou encadear a etapa
  seguinte sem pedido; `Agent` solto fora do que a própria skill lança; commit, push ou merge
  sem pedido explícito; commit na `main`; subir o dev server; gravar segredo; usar
  `localhost` entre serviços do Compose (exceção só para `S3_PUBLIC_ENDPOINT`).
