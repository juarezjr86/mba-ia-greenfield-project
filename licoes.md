# Lições aprendidas — Fase 03 (StreamTube)

> Registro acumulativo (nunca apagar lições anteriores). Cada lição: **Simples** (o que
> aconteceu e por quê) e **Técnico** (conceito, aplicação no projeto, trade-offs).

## 2026-10-10 — Setup e research da Fase 03

### L-01. Conferir a branch base antes de criar a branch da fase
- **Simples:** o `dev` do fork estava 41 commits atrás da `main` e não tinha a Fase 02.
  Criar `feature/phase-03-videos` a partir dele deixaria o projeto sem auth e sem canais.
- **Técnico:** `git rev-list --count origin/main..origin/dev` (à frente) e
  `origin/dev..origin/main` (atrás) mostram a defasagem; quando `dev` é ancestral da `main`,
  o avanço é um fast-forward sem commit de merge. O Git Flow do projeto diz "a partir de
  `dev`", então a correção foi sincronizar o `dev` local, não ramificar da `main`.

### L-02. "Suíte verde" depende do estado do banco
- **Simples:** o `npm test` passa em banco virgem e falha na segunda execução; o e2e só passa
  depois que a suíte unit/integração deixou o schema migrado.
- **Técnico:** `migrations.integration-spec.ts` derruba tabelas mas não o tipo ENUM
  (`verification_tokens_type_enum`), então o `CREATE TYPE` da migration falha; o `afterAll`
  quebra antes de `dataSource.destroy()` e a conexão aberta impede o Jest de encerrar.
  Reset local: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`. É dívida da Fase 02.

### L-03. Documentação e ambiente podem divergir (ambiente vence)
- **Simples:** enunciado e `CLAUDE.md` mandam usar MinIO em Docker, mas a imagem oficial
  `minio/minio` não é mais distribuída (Docker Hub: "object not found").
- **Técnico:** a *API S3* é o contrato; a *imagem* é detalhe de distribuição. Por isso a
  decisão virou TD-03 (qual imagem serve o contrato) e não uma troca de tecnologia. A
  verificação foi `docker manifest inspect <imagem>` + API do registry.

### L-04. URL pré-assinada é amarrada ao host que a gerou
- **Simples:** o navegador não resolve o nome interno do Compose (`minio`), então a URL
  entregue ao cliente precisa usar o endereço publicado no host.
- **Técnico:** a assinatura SigV4 inclui o header `Host`. Logo: endpoint interno
  (service name) para chamadas API→storage e endpoint público para URLs entregues ao cliente.
  A regra "nunca `localhost`" vale para serviço→serviço, não para a URL do cliente.

### L-05. Upload de 10GB: PUT simples não resolve; multipart sim
- **Simples:** S3 tem limite para um PUT único; arquivos grandes precisam ser enviados em
  partes.
- **Técnico:** multipart aceita partes de 5 MiB a 5 GiB (a última pode ser menor), até
  10.000 partes. Com URLs pré-assinadas por parte, o arquivo vai direto ao storage e a API só
  coordena (iniciar, assinar partes, finalizar).

### L-06. Validar antes de recomendar (spike descartável)
- **Simples:** em vez de confiar só na documentação, um script curto testou multipart,
  Range/206, download e CORS contra a imagem candidata.
- **Técnico:** o spike rodou fora do repositório, em rede Docker temporária. Resultado
  útil também pelo que falhou: a regra de lifecycle `AbortIncompleteMultipartUpload` foi
  rejeitada e ficou registrada como questão aberta (OQ-1), sem afirmar o que não foi provado.

### L-07. Aceitar recomendações em bloco é decisão, mas a justificativa precisa de origem
- **Simples:** os 12 TDs foram fechados com "aceito todas as recomendações". Vale como
  decisão do aluno, desde que o registro diga de onde veio a justificativa.
- **Técnico:** cada `Decision` aponta para o parágrafo `Recommendation` do próprio TD (origem
  rastreável) e leva a data e o autor. Dois TDs carregam condição que a aceitação não
  elimina: TD-07 exige validar ffprobe com arquivo grande sem faststart antes do
  `plan-build`; TD-03 exige tag fixada e a divergência "MinIO" registrada (OQ-5).

### L-08. Esclarecimento de ambiguidade precisa de um lugar durável
- **Simples:** responder "qual critério?" numa pergunta não basta: se a resposta fica só no
  `validation.md`, o plano não a enxerga.
- **Técnico:** o `plan-build` consome `context.md`, que herda do documento de decisões as
  linhas `Recommendation`, `Libraries` e `Revisions`. Por isso as respostas de AMB/DG/OQ foram
  gravadas como `Revisions` do TD dono (ex.: regra de acesso no TD-09, parâmetros de retry no
  TD-11). Limite do pipeline: a tabela de Open Questions do research não chega ao
  `plan-validate`; foi preciso citar a origem de cada item que veio de fora do `context.md`.

### L-09. Condição de decisão vira issue aberta até haver evidência
- **Simples:** aceitar o TD-07 "com condição" não resolve a condição; ela só fecha com o teste.
- **Técnico:** a validação de ffprobe sobre URL com arquivo sem faststart depende da posição
  do átomo moov (índice no fim do arquivo exige leituras por `Range` em dois pontos). O spike
  mede bytes realmente lidos; só então o TD-07 A se confirma ou cai para o fallback B.

### L-10. Spike do OQ-1: o índice no fim do arquivo não obriga a baixar o vídeo
- **Simples:** um MP4 de 2GB sem faststart foi analisado lendo 3MB (ffprobe) e 7MB (thumbnail),
  sem baixar o arquivo. O worker pode ler direto da URL do storage.
- **Técnico:** ffprobe e ffmpeg abrem o início, saltam por `Range` até o átomo `moov` (no fim,
  offset 2.075.946.186) e fazem seek para o ponto do frame; 3 a 4 GETs com `Range`, 0,15% e
  0,35% do arquivo. Limites que ficam registrados: só 2GB, só MP4/H.264, servidor próprio em
  loopback (não o `pgsty/silo` nem SigV4), então o SI de storage precisa de um smoke test do
  fluxo real. Ferramentas que faltam na imagem (`curl`, `time`) não entram no worker: a medição
  foi feita em Node.

### L-11. Editar o documento de decisões fora do `plan-resolve` reabre a cadeia
- **Simples:** gravar a Revision do spike no TD-07 deixou `context.md` e `validation.md`
  velhos; o pipeline abortou até regenerar tudo na ordem certa.
- **Técnico:** cada artefato guarda o mtime das fontes (`sources_mtime`) e os estágios abortam
  se alguma fonte for mais nova. Edição manual no documento de decisões obriga
  `/plan-context` → `/plan-validate` → `/plan-resolve`; só o `plan-resolve` edita o documento e
  já refresca os mtimes. Para evitar o ciclo, a Revision do spike deveria ter entrado pelo
  próprio `plan-resolve` (resposta ao OQ-1), não antes.

### L-12. Documentação de biblioteca pode trazer a API da versão antiga
- **Simples:** o exemplo do Context7 para configurar a fila usava `redis`, mas o pacote que o
  projeto vai usar espera `connection`.
- **Técnico:** o trecho de `docs.nestjs.com` mostrava `BullModule.forRootAsync({ redis })`, que
  é o `@nestjs/bull` legado; o repositório `/nestjs/bull` documenta `@nestjs/bullmq` com
  `connection`. Registrado no `library-refs.md` como discrepância de versão. O que o Context7
  não devolveu (formato do `UploadPartCommand`, `lockDuration`, bootstrap standalone do worker)
  ficou marcado como "Not confirmed" para o SI conferir nos tipos instalados, em vez de inferir.

### L-13. O guard global e o throttler global moldam o desenho das rotas públicas
- **Simples:** o plano precisou de duas coisas que o código da Fase 02 não oferece: saber quem
  é o dono do vídeo numa rota pública e não limitar o upload a 10 requisições por minuto.
- **Técnico:** `JwtAuthGuard` retorna `true` em rota `@Public()` sem preencher `request.user`
  (entra o decorator opt-in `@OptionalAuth()`); `ThrottlerGuard` é `APP_GUARD` global em
  `auth.module.ts` (10/min), embora `phase-02-auth/TD-08` diga "só AuthModule". Divergência
  apresentada ao aluno, que escolheu `@Throttle` próprio no `VideosController`. O parecer do
  advisor mudou o desenho: a decisão saiu do plano silencioso e virou pergunta.

### L-14. Isolamento de teste: prefixo de fila e endpoint público
- **Simples:** um processador subido dentro de um teste competiria com o `video-worker` do
  Compose, e uma URL assinada para `localhost` não abre de dentro do container.
- **Técnico:** `QUEUE_PREFIX` (prefixo de chaves do BullMQ) dá fila privada ao teste;
  `S3_PUBLIC_ENDPOINT` aponta para o endereço interno só no ambiente de teste, e o endereço
  publicado é exercitado por `curl` manual no host (revisão cega achou que o plano nunca o
  testava).

### L-15. Módulo de worker não importa módulo de API
- **Simples:** se o worker importasse o módulo com controllers, ele carregaria rotas HTTP que
  nunca usa; se o teste importasse o worker inteiro, abriria duas conexões raiz ao banco.
- **Técnico:** `VideoProcessingModule` (não-raiz: `forFeature`, storage, mídia, fila) é
  importado por `WorkerModule` (raiz, só para o processo do worker) e pelos testes ao lado de
  `AppModule`. O status do vídeo no worker é atualizado por `VideoProcessingService`, não por
  `VideosService`.

### L-16. A revisão cega (Opus) achou 23 críticas; 19 viraram edição, 3 viram pergunta ao aluno
- **Simples:** a revisão sem o meu veredito pegou falhas que eu não via: o `complete` pode
  deixar o vídeo preso se falhar entre o storage e o banco, o fallback do TD-07 não tinha SI,
  o serviço lançava exceção HTTP, o watch do worker apagaria o `dist/` da API.
- **Técnico:** conferidas na fonte antes de acatar (regra `nestjs-services.md`,
  `nest-cli.json` com `deleteOutDir: true`, `openapi.json` com DTOs vazios). Ficaram para o
  aluno: Revisions pendentes no documento de decisões (lib-storage, abort, 401/404/JSON,
  throttle, "SI-03.0"), a interpretação "dono em qualquer status" vs 409 em `draft`, e o
  DTO de request vazio no `openapi.json` (lacuna herdada da Fase 02).

### L-17. O throttle "por módulo" do Fase 02 era, na prática, global
- **Simples:** a decisão da Fase 02 dizia que o limite de requisições valia só para a
  autenticação, mas o código registra o guard para a aplicação inteira (10 por 60 s em toda
  rota). Se a Fase 03 herdasse isso sem olhar, o envio de um arquivo de 10GB em milhares de
  partes bateria no limite do login.
- **Técnico:** conferido em `auth.module.ts:29-35` (`ThrottlerGuard` como `APP_GUARD`). A
  Fase 03 mantém `@nestjs/throttler` e sobrescreve o limite por controller com `@Throttle`
  lido de `VIDEOS_THROTTLE_LIMIT` e `VIDEOS_THROTTLE_TTL_MS`. A Revision foi gravada no
  TD-08 da `phase-02-auth`; o motivo além da independência do limite não está registrado e
  não foi inventado. O `context.md` da Fase 02 não foi regenerado, então a Recommendation
  herdada ainda diz "escopo só no AuthModule": a Revision foi anexada ao bloco herdado.

### L-18. EXC-02: as skills do pipeline deixam de ser só manuais
- **Simples:** o aluno pediu que a IA possa disparar as etapas do pipeline (`research`,
  `plan-context`, `plan-validate`, `plan-resolve`, `plan-build`, `plan-test-specs`,
  `implement`, `decide`), mas continua mandando na ordem.
- **Técnico:** exceção ao `CLAUDE.md` do fork (`disable-model-invocation: false` nessas 8
  skills), com limites: ordem do workflow, portões de decisão da EXC-01 e uma etapa por vez,
  sem encadear. Validade 2026-12-31; motivo "não informado". Na prática, nesta sessão cada
  etapa só rodou quando o aluno pediu (`/plan-context`, `/plan-validate`, `/plan-test-specs`).

### L-19. Revisão do advisor sobre o plano gravado: 2 de 6 pontos eram só de processo
- **Simples:** o advisor apontou que os testes dentro do container não alcançariam URLs
  assinadas para `localhost` e que a fila de teste competiria com o worker. Ambos já estavam
  resolvidos no plano (L-14); faltava só repetir isso no `Setup` dos specs gerados.
- **Técnico:** conferido por grep antes de acatar: `S3_PUBLIC_ENDPOINT` interno nos testes
  (SI-03.5 e SI-03.19) e `QUEUE_PREFIX` (SI-03.4 e SI-03.7). `GET /auth/me` existe e é
  protegido (`auth.controller.ts:247`). O que mudou de verdade: `Setup` de 6 specs, o
  `library-refs.md` (lib-storage anotada como descartada) e a decisão do aluno sobre commits
  (preflight do `/implement` exige árvore limpa fora de `nestjs-project/`; o TD-12 exige
  commits dedicados em SI-03.1 e SI-03.2).

### L-20. `Promise.all` de DROP TABLE ... CASCADE trava o banco de teste (deadlock)
- **Simples:** quando a SI-03.6 somou a tabela `videos`, que aponta para `channels`, a suíte de migrations passou a falhar com "deadlock detected" na primeira rodada e a passar na segunda. A causa era apagar as tabelas em paralelo.
- **Técnico:** `dataSource.query` em `Promise.all` usa conexões diferentes do pool; `DROP TABLE ... CASCADE` em tabelas ligadas por FK pega travas em ordens opostas. Corrigido com laço sequencial em `migrations.integration-spec.ts` (3 rodadas completas verdes a partir de schema virgem). Efeito colateral da mesma SI: `Channel` ganhou `videos`, então toda lista `ALL_ENTITIES` dos testes precisou incluir `Video` (o `createTestDataSource` sincroniza o schema), e `npx prettier --write src` reformatou dois `.hbs`, revertidos com `git checkout`.
