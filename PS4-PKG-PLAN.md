# Lume Games — plano do PKG para PS4

O PKG do PS4 será um cliente nativo separado. Ele poderá ler catálogos JSON públicos, mostrar apenas entradas compatíveis com PS4 e consultar `/release/latest` para avisar sobre atualizações.

Ele não reutiliza a sessão Electron do desktop. A autenticação do Archive, se necessária e permitida, precisa ser implementada no cliente PS4 com armazenamento seguro e login explícito.

A geração final exige uma toolchain PS4/homebrew compatível e assinatura/instalação autorizada no console. O código desktop não pode ser convertido diretamente em PKG.

