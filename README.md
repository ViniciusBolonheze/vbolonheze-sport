# Sistema Aberto — versão inicial local

Esta pasta contém a primeira cópia independente do **SA (Sistema Aberto)**. Os arquivos originais enviados permanecem intactos em `/home/user/uploads/`.

## O que está ativo

- **Teste grátis:** entra sem login ou senha e libera os módulos internos.
- **Limite:** até **15 atletas**. A validação ocorre ao adicionar uma linha, cadastrar pelo formulário, importar uma planilha e salvar os dados.
- **Login/Senha e Comprar:** aparecem na entrada, mas ainda estão desativados.
- **Calendário:** a aba/atalho foi retirada; no mesmo espaço está o **Portal do Atleta**.
- **Portal local:** lista os atletas cadastrados; o atleta escolhe o nome e confirma o ano de nascimento, sem senha. PSR, PSE e mensagens para Preparação Física são salvos localmente. A equipe responde no módulo Preparação Física, e a resposta aparece no portal.
- **Monitoramento:** lê as respostas locais do PSR/PSE. A carga de sessão é PSE × duração; PSE 0 (repouso) não gera carga. CA7 soma as últimas 7 sessões, CC28 é a média semanal das últimas 28 sessões, e ACWR é CA7/CC28. A variação compara as últimas 7 sessões com as 7 anteriores. As zonas locais são: ACWR < 0,8 (azul), 0,8–1,3 (verde), 1,3–1,5 (atenção) e > 1,5 (sobrecarga). São indicadores simplificados, não diagnóstico ou prescrição.
- **Jogos:** a tela inicial permite adicionar treinadores; a lista e os jogos ficam no dispositivo.
- **Testes Físicos:** começa com uma única avaliação padrão. Avaliações posteriores são criadas pelo botão **Adicionar Avaliação**.

## Armazenamento

- Registros e arquivos são guardados no **IndexedDB** do navegador; se o IndexedDB não estiver disponível, a aplicação tenta usar `localStorage` como alternativa, com capacidade menor. Preferências usam `localStorage` com o prefixo `sistema_aberto_v1:`.
- O banco local tem o nome `sistema_aberto_local_v1`. Não há cliente, URL ou chave Supabase, nem chamadas remotas para consultar ou salvar dados. O portal, o monitoramento e os treinadores usam tabelas locais independentes.
- O acesso do atleta usa apenas seleção do nome e ano de nascimento; isso não é autenticação forte. Não deixe o portal aberto em dispositivo compartilhado e evite cadastrar informações sensíveis nesta etapa.
- Os dados ficam no perfil do navegador e na origem/domínio em que a aplicação for aberta. Limpar os dados do site, usar janela anônima ou mudar de navegador/dispositivo pode fazer os dados deixarem de estar disponíveis. A persistência local não é uma cópia de segurança.
- Como o modo grátis e o contador são locais, o limite é de uso da interface, não uma proteção antifraude: limpar os dados do navegador pode zerar o teste e o contador. Isso é esperado nesta etapa de protótipo.
- Para dados importantes, faça exportações regulares e mantenha uma cópia segura. A exportação de planilha cobre o cadastro principal; outros módulos podem precisar de exportação própria.

## Como abrir

Recomenda-se servir esta pasta por HTTP/HTTPS em vez de abrir o HTML diretamente como `file://`.

Em um computador com Python instalado, abra o terminal nesta pasta e execute:

```bash
python3 -m http.server 8000
```

Depois, acesse `http://localhost:8000` no computador. Para abrir no celular pela mesma rede Wi-Fi, sirva a pasta com `python3 -m http.server 8000 --bind 0.0.0.0` e acesse no celular `http://<IP-do-computador>:8000`. Use apenas em uma rede confiável e não exponha esse servidor à internet. O banco fica no perfil do navegador de cada aparelho — os dados não sincronizam entre computador e celular.

## Observação sobre internet

O armazenamento e as operações de dados são locais. Esta edição ainda carrega bibliotecas públicas de ícones, leitura de Excel e exportação PDF por CDN; portanto, alguns recursos visuais, de importação ou PDF podem precisar de internet. Isso não envia o banco local para o Supabase. Recursos de compartilhamento (por exemplo, vídeo pelo menu do dispositivo) só atuam quando o usuário os aciona.

## Arquivos

- `index.html` — interface e módulos.
- `script.js` — lógica do sistema e camada de armazenamento local.
- `style.css` — estilos e identidade visual SA.
- `sa-logo.svg` e os PNGs de campo, bola e uniformes — assets genéricos locais desta cópia.
