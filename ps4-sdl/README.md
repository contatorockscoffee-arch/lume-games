# Lume Games PS4

Cliente homebrew nativo do Lume Games para PS4, construído com OpenOrbis, SDL2 e FreeType.

## Estado atual

Esta é a reconstrução visual nativa: navegação segura em TV 1080p, tema escuro/claro, cartões com foco, detalhes e fila de demonstração. A camada de catálogo remoto e downloads de fontes autorizadas será ligada a este renderizador em etapas separadas.

O projeto nunca deve conter cookies do Internet Archive, contas pessoais, PKGs de terceiros ou links privados.

## Requisitos

- OpenOrbis PS4 Toolchain instalado;
- LLVM/Clang no `PATH`;
- variável `OO_PS4_TOOLCHAIN` apontando para a instalação;
- fontes e módulos do diretório `assets/` e `sce_module/` preservados localmente.

## Build no Windows

No diretório `SDL2`:

```powershell
.\build.bat x64\Debug lume ..
```

O pacote é gerado na raiz do projeto como `IV0000-LUME00001_00-LUMEGAMES0000000.pkg`.

## Controles atuais

- `←` / `→`: selecionar cartão;
- `L1` / `R1`: trocar filtro;
- `X`: abrir detalhes ou adicionar à fila de demonstração;
- `O`: voltar;
- `△`: alternar tema claro/escuro.

## Fonte

O esqueleto de SDL2 é derivado do exemplo do OpenOrbis. A interface Lume é código próprio deste projeto.

