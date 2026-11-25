# Lume Games API

Serviço separado para Railway. O protótipo fornece cadastro, login, sessão e configuração de doações. Antes de produção, defina `LUME_SESSION_SECRET`, `LUME_DONATION_URL` e um armazenamento persistente/backup para `data.json`; o arquivo local serve apenas para desenvolvimento.

Use `.env.example` como checklist. O armazenamento JSON é adequado apenas para protótipo; em produção, substitua-o por PostgreSQL ou outro banco gerenciado, habilite HTTPS no domínio Railway e configure limites de requisição, verificação de e-mail e recuperação de conta.

Não armazena cookies do Internet Archive, senhas do Archive, arquivos PKG nem histórico detalhado de downloads.

