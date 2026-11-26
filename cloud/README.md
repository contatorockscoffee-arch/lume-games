# Lume Games API

Serviço no Railway (projeto **Lume Games**, serviço `lume-api`). Ele é publicado a partir deste repositório, branch `main`, usando o `cloud/Dockerfile`.

Endereço: `https://lume-api-production-1838468f.up.railway.app`

Dados guardados no volume (`/data`):
- `LUME_DB`: contas e aparelhos, em JSON.
- `saves/<usuário>/`: os saves.
- `archive/<usuário>.bin`: sessão do Internet Archive criptografada, quando configurada.

Não armazena senhas do Archive. A sessão é opcional e guarda somente os cookies criptografados com `LUME_ARCHIVE_SESSION_KEY`.

Variáveis de ambiente:

| Variável | Para que serve |
|---|---|
| `LUME_SESSION_SECRET` | Obrigatória. |
| `LUME_DB` | Caminho do JSON de contas. |
| `LUME_SAVE_QUOTA_MB` | Cota por conta. Padrão: 256. |
| `LUME_SAVE_MAX_FILE_MB` | Tamanho máximo de um arquivo. Padrão: 48. |
| `LUME_PUBLIC_URL` | Opcional. Padrão: `https://$RAILWAY_PUBLIC_DOMAIN`. |
| `LUME_DONATION_URL` | Link de doação. |
| `LUME_ARCHIVE_SESSION_KEY` | Chave secreta obrigatória para habilitar o relay autenticado do Archive. Gere uma chave aleatória forte e configure-a como segredo no Railway. |
| `LUME_ARCHIVE_DIR` | Pasta do volume para as sessões criptografadas. Padrão: ao lado do `LUME_DB`. |

O armazenamento em JSON serve para poucos usuários. Para crescer, troque por PostgreSQL ou outro banco gerenciado.

## Contas

| Rota | O que faz |
|---|---|
| `POST /auth/register` `{email, password}` | Cria a conta. Devolve `201 {token, user}`. O token de sessão vale 30 dias. |
| `POST /auth/login` `{email, password}` | Devolve `200 {token, user}`. |
| `GET /me` | Devolve `{user, device}`. |

Todas as rotas protegidas usam `Authorization: Bearer <token>`.

## Sessão do Internet Archive

O Desktop abre o login oficial do Archive em uma sessão persistente do Electron. Depois que o usuário entra, ele pode sincronizar a sessão com a conta Lume. O servidor recebe somente os cookies do domínio `archive.org`, cifra-os em repouso e nunca recebe a senha.

| Rota | O que faz |
|---|---|
| `GET /archive/session` | Informa se o relay está habilitado e se há uma sessão salva; não devolve cookies. |
| `PUT /archive/session` | Recebe os cookies exportados pelo Desktop e os cifra para a conta autenticada. |
| `DELETE /archive/session` | Apaga a sessão salva. |
| `GET /archive/proxy?u=<URL Archive>` | Faz o download autenticado para o PS4/cliente vinculado, seguindo até 6 redirecionamentos somente dentro de `archive.org`. Mantém `Range` para retomada. |

Sem `LUME_ARCHIVE_SESSION_KEY`, as rotas retornam que o recurso está desabilitado e nenhum cookie é persistido.

## Conectar um aparelho por código (PS4)

1. O aparelho chama `POST /device/start {name}` e recebe `{code, pollId, url, link, expiresIn: 600}`.
   - `code` tem 6 caracteres (sem 0/O/1/I).
   - `link` já leva o código; o PS4 mostra esse link como QR code.
2. A pessoa confirma o código de duas formas:
   - na página `GET /vincular?c=CODE` (celular ou PC: entra ou cria conta e confirma);
   - ou em qualquer app já logado, com `POST /device/approve {code}` (Bearer da conta). O código pode vir com hífen ou espaço.
3. O aparelho consulta `GET /device/poll?id=<pollId>` a cada 3 s. As respostas são:
   - `202`: ainda pendente;
   - `200 {token, email}`: conectado (o token é entregue uma vez só);
   - `410`: o código expirou.

Detalhes do token do aparelho:
- Vale 1 ano e leva o id do aparelho.
- `GET /devices` lista os aparelhos.
- `POST /devices/revoke {id}` desconecta um aparelho. Sem `id`, desconecta o próprio aparelho que fez o pedido.

## Saves

### Formato dos caminhos

| Caminho | O que é |
|---|---|
| `saves/<console>/<arquivo>` | Save normal (bateria/SRAM, `.srm`). É igual entre o PS4 e o desktop, porque os cores são os mesmos. |
| `states/<aparelho>/<console>/<arquivo>` | Estado (save state). Cada aparelho tem o seu (`ps4`, `desktop`), porque o formato depende da versão do core. |

Regras dos nomes:
- `<console>` é o nome da pasta principal do Lume: `nes`, `snes`, `gb`, `gbc`, `gba`, `megadrive`, `mastersystem`, `gamegear`, `ps1`, `atari2600`, `arcade`, `pcengine`, etc. A lista completa está em `SYSTEMS` de `ps4-sdl-retro/SDL2/lume_retro.cpp`.
- `<arquivo>` é o nome do arquivo do jogo, sem extensão, mais `.srm` ou `.state`. Exemplo: `Super Mario World (USA).srm` para `Super Mario World (USA).sfc` ou `.zip`.
- Não podem aparecer `/ \ : * ? " < > |`, caracteres de controle, `.` nem `..`.

### Rotas

| Rota | O que faz |
|---|---|
| `GET /saves` | Devolve `{files:[{path,size,mtime,sha256,updatedAt,device}], usedBytes, quotaBytes}`. |
| `GET /saves?format=tsv` | Uma linha por arquivo: `path\tsize\tmtime\tsha256`. É o formato usado pelo PS4. |
| `GET /saves/file?p=<caminho>` | Devolve os bytes, com os cabeçalhos `x-lume-mtime` e `x-lume-sha256`. |
| `PUT /saves/file?p=<caminho>&mtime=<segundos>` | O corpo são os bytes do arquivo. |
| `DELETE /saves/file?p=<caminho>` | Apaga o arquivo. A última versão fica guardada no histórico. |

Detalhes do `PUT`:
- O cabeçalho opcional `X-Lume-Base: <sha256 da versão que o cliente conhecia>` (ou `none`, se o cliente achava que não existia nada) evita sobrescrever o que outro aparelho enviou. Se a nuvem tiver outra versão, a resposta é `409 {current}`.
- `&force=1` sobrescreve mesmo assim. A nuvem guarda as 3 versões anteriores de cada arquivo.
- A resposta normal é `200 {sha256}`.
- Os limites dão `413`: o arquivo passou do máximo ou a conta passou da cota.

### Regra de sincronização usada pelo PS4 (`ps4-sdl-retro/SDL2/lume_cloud.cpp`)

Por arquivo, compare três versões: a local, a da nuvem e a da última sincronização.

| Situação | O que fazer |
|---|---|
| Só a local mudou | Envia. |
| Só a nuvem mudou | Baixa. |
| As duas mudaram | Vence a de `mtime` mais novo. |

Quando as duas mudaram, nada se perde:
- se a nuvem vence, a cópia local fica ao lado como `<arquivo>.ps4-<data>.bak`;
- se a local vence, ela vai com `force=1` e a nuvem guarda a anterior.

Arquivos `.bak` e `.tmp` não sobem.

## Teste local

```
node cloud/server.js
```

Os dados ficam em `cloud/data.json` e `cloud/saves`. O teste ponta a ponta usado no desenvolvimento cobre:
- cadastro;
- pareamento;
- conflito;
- cota;
- caminhos inválidos;
- revogação.

