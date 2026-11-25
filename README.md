# Meu Acervo Desktop

Aplicativo Windows para catalogar itens próprios ou autorizados do Internet Archive e transferir arquivos para um PS4 via FTP.

## Desenvolvimento

1. Instale as dependências com `npm install`.
2. Rode `npm start`.
3. Gere instalador e versão portátil com `npm run dist`.

O catálogo é persistido automaticamente no armazenamento local do aplicativo e reaparece em toda abertura. Em **FTP do PS4**, configure o IP exibido pelo servidor FTP do console, a porta e o diretório remoto (por padrão `/data/pkg`).

## Base para PS4

A interface em `app/` usa HTML, CSS e JavaScript sem framework e pode ser reaproveitada por um wrapper homebrew. O empacotamento PKG exige um toolchain PS4 homebrew separado e compatível com o ambiente do console.

