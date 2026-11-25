# Publicação separada

## Railway

Crie um serviço novo apontando para `cloud/railway.json` e configure:

- `LUME_SESSION_SECRET`: segredo aleatório longo;
- `LUME_DONATION_URL`: URL pública de doação;
- `LUME_DB`: caminho de volume persistente, quando houver volume configurado.

O endpoint de saúde é `/health`. Não reutilize variáveis, banco ou domínio de outros projetos.

## GitHub

Publique este diretório como um repositório novo chamado `lume-games`. Tags como `v2.2.0` acionam o workflow de build e release. Para atualizações automáticas do Electron, configure o campo `publish` do `package.json` apontando para esse repositório e use assinatura de código no Windows.

