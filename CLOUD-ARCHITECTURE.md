# Lume Games — arquitetura online

## Desktop

O aplicativo continua local para downloads, extração, biblioteca e FTP. A sessão do Internet Archive permanece no cofre de cookies persistente do Electron e nunca é enviada ao backend.

O `electron-updater` já está integrado e o `package.json` aponta para as Releases de `contatorockscoffee-arch/lume-games`. O workflow de tags gera instalador e portátil. Para uma distribuição comercial, ainda é necessário configurar assinatura de código Windows; sem ela, o Windows pode exibir o aviso de editor desconhecido.

## Backend Railway

O serviço separado deve fornecer apenas autenticação, preferências sincronizadas, catálogo público e links de doação. Não deve receber senhas do Archive, cookies, arquivos PKG ou dados detalhados de downloads.

Endpoints planejados: `POST /auth/register`, `POST /auth/login`, `GET /me`, `GET /catalog`, `GET /release/latest`, `GET /donations/config`.

## Privacidade

Telemetria deve ser opt-in e agregada. O lembrete de doação nunca bloqueia catálogo ou download autorizado.

