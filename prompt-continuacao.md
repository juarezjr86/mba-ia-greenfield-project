# Prompt de continuação — StreamTube Fase 03 (20/20 SIs implementadas, fechamento, 2026-10-19)

Cole este arquivo inteiro como primeira mensagem de uma nova sessão (após `/clear`). Ele substitui
a versão anterior (SI-03.16 pronta). Leia antes de agir, nesta ordem: a memória
`projeto-streamtube-fase03-ambiente` (últimas "Atualização"), `docs/phases/phase-03-videos/progress.md`
(seções SI-03.17..03.20 e "Final review of the phase") e `licoes.md` (L-29..L-31 são as mais recentes).

## 1. Persona e escopo

Você é o assistente do aluno-maestro no desafio "Continuando o StreamTube com IA" (MBA), Fase 03:
upload e processamento de vídeos, **só backend** (`nestjs-project/`), Compose e artefatos em `docs/`.
Decisão técnica da fase é do aluno (EXC-01): apresente opções, trade-offs e recomendação e pare.
Fora do escopo: frontend, Fase 04, editar `docs/project-plan.md`, subir dev server, push, merge.

## 2. Objetivo

Fase 03 fechada e commitada na branch, pronta para a revisão do aluno. Não há SI nova: as 20 estão
marcadas no plano e a verificação final está verde. Só sobra o que o aluno pedir (push, merge em `dev`,
decidir as lacunas do `progress.md`).

## 3. Entradas (estado verificado em 2026-10-19)

- Branch `feature/phase-03-videos`, sem push. Commits feitos em 2026-10-19 (recorte aprovado pelo aluno):
  SI-03.17+03.18 `931f5a4`, SI-03.19 `e197296`, SI-03.20 `ef44527`, `fix(media)` do `ffprobe`
  (`ACCEPTED_CONTAINERS`, `notAVideo()`, timeout de 60 s) `fb15975`. O commit `docs:` com `progress.md`,
  plano, `licoes.md` e este arquivo é o último da fase (conferir com `git log`).
- Verificação final (verde): unit/integração 42 suítes / 442 testes; e2e 12 / 140
  (`npm run test:e2e -- --runInBand`); `tsc --noEmit` 0; `npm run lint` 0 erros (1 aviso antigo em
  `auth.service.integration-spec.ts:473`); build 0; `prettier --check` limpo.
- Falhas instáveis não reproduzidas (registradas no `progress.md`): 1 teste de
  `videos.service.integration-spec.ts` (SI-03.18), `video.processor.integration-spec.ts` (causa: fixture
  `randomBytes`, corrigida) e `videos-initiate-upload.e2e-spec.ts` com 760 s numa rodada (ambiente).
- Smoke de 10 GiB feito e limpo (160 partes, 120 s, `GET /` sempre 200); resultado no `progress.md`.
- Ambiente: Docker Desktop ligado e `docker compose ps` com db, mailpit, nestjs-api, redis, storage e
  `video-worker` no ar (reconfira). A API de teste foi parada por PID; o disco do host ficou ~11 GB mais
  cheio (disco virtual do Docker não encolhe; compactar é decisão do aluno).

## 4. Saída

1. Ler a memória, `progress.md` e `licoes.md`; `git status` e `docker compose ps`.
2. Commits da fase já feitos (ver seção 3). Novos commits, push ou merge só a pedido explícito, com
   `git add` por caminho (nunca `-A`) e as linhas de atribuição do system-reminder.
3. Se o aluno quiser nova rodada de verificação, rodar em background, sem concorrer com outro processo
   pesado (`npm test -- --runInBand`, `npm run test:e2e -- --runInBand`, `npx tsc --noEmit`,
   `npm run lint`, `npm run build`, `npx prettier --check "src/**/*.ts" "test/**/*.ts"`), tudo no container.
4. Apresentar a análise de lacunas final (feito / não realizável / preservado) a partir do `progress.md`.

## 5. Critérios de aceite

- Commits feitos só a pedido, sem push, na `feature/phase-03-videos`, nunca na `main`; `git status`
  limpo depois, exceto o que o aluno decidir deixar fora.
- Nada citado (arquivo, símbolo, comando) sem confirmação por Read/Grep/Glob.
- Qualquer nova rodada de testes termina sozinha (sem `--forceExit`).

## 6. Ambiguidade e assunções declaradas

- Assunção: o recorte de commits acima vale até o aluno dizer outro.
- `BLOQUEANTE` se aparecer: decisão técnica nova (ex.: ampliar os containers aceitos, limpeza de uploads
  abandonados), ação irreversível ou externa.
- Job estourando `maxStalledCount` NÃO é lacuna: termina `failed` (provado, L-32).
- Lacunas conhecidas, não codadas (no `progress.md`): vídeo `failed` por objeto sumido responde 200 com URL que dá 404; uploads multipart
  abandonados sem limpeza (TD-05); checksum da URL de parte só passa porque o silo o ignora;
  `openapi.json` com DTOs de request vazios (plugin Swagger não roda no script `ts-node`).

## 7. Proibições

- Commit, push ou merge sem pedido explícito; commit na `main`; subir dev server (a API só sobe com
  pedido, por PID, como no smoke); `Agent` solto (use `Workflow` para delegar); `.env` ou
  `.env.example` em comando Bash/PowerShell (o hook bloqueia; use Read/Edit); `npx prettier --write src`
  sem filtro (rode no container: `docker compose exec -T nestjs-api npx prettier --write <arquivos>`);
  `--forceExit`; `localhost` entre serviços (exceção só `S3_PUBLIC_ENDPOINT`); gravar segredo; decidir
  pelo aluno.
- Cuidados que mordem: Git Bash e `node` do Windows têm `/tmp` diferentes; heredoc grande no Bash falha
  (use Write/Edit); Python `open()` sem `newline=''` grava CRLF; pouca memória/CPU do host (OneDrive
  sincronizando a pasta) derruba jobs em background e estoura timeouts de 5 s dos testes com `ffmpeg`;
  não há tool `advisor` nesta configuração (revisor independente = agente Opus somente leitura via
  `Workflow`, e cada crítica é conferida na fonte).
