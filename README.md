# Pauta Técnica

Aplicativo web local para cadastrar e acompanhar projetos prioritários por área técnica. Os dados ficam em uma base SQLite no próprio computador.

## Como executar

Requisito: Node.js 22.5 ou mais recente.

```powershell
npm start
```

Depois, abra [http://127.0.0.1:3000](http://127.0.0.1:3000) no navegador. Para encerrar, pressione `Ctrl+C` no terminal.

## Recursos

- cadastro, edição e exclusão de registros;
- busca obrigatória de novas proposições na Câmara por tipo, número e ano, com projeto e ementa automáticos;
- listas de áreas, responsáveis e status baseadas na aba `Parâmetros` da planilha original;
- filtros por área técnica, responsável, parecer, sugestão de emenda e posicionamento;
- busca por projeto, ementa, comissão ou responsável;
- aba de totalização filtrável, com quantidades e percentuais por área e pelos três campos de status;
- exportação protegida por senha da base completa ou filtrada em CSV compatível com Excel;
- anexos opcionais em PDF, documentos do Office, texto ou imagem;
- datas de inclusão e de última edição, além de proteção contra fechamento com alterações não salvas.

## Persistência

A base é criada automaticamente em `data/registros.sqlite`, e os anexos ficam em `data/uploads/`. Ambos são ignorados pelo Git: atualizações de código não substituem esses dados. Para um backup completo, preserve o arquivo SQLite e a pasta de uploads.

## Consulta à Câmara

No novo cadastro, selecione um dos 12 tipos disponíveis e digite número e ano. A consulta a `https://dadosabertos.camara.leg.br/api/v2/proposicoes` só ocorre ao clicar em **Pesquisar** com os três parâmetros válidos. Havendo um resultado, ele é selecionado automaticamente; havendo vários IDs, escolha o desejado para consultar `/proposicoes/{id}`. Nenhum registro ou anexo local é enviado à Câmara.

Projeto e ementa são preenchidos pela consulta e protegidos contra edição manual. Atual comissão e os demais campos continuam manuais. O ID, a data de apresentação, a data/hora do status e a data da consulta são armazenados no SQLite e exibidos no detalhamento. Essas datas são uma fotografia da consulta, sem atualização em segundo plano. Valores ausentes na Câmara são apresentados como não informados.

Sem resultado ou com a API indisponível, o novo registro não pode ser salvo. A seleção fica válida por duas horas; se o servidor reiniciar antes de salvar, faça a busca novamente. O servidor precisa de acesso HTTPS a `dadosabertos.camara.leg.br`.

Os registros anteriores à integração permanecem disponíveis e editáveis sem consulta; para trocar o projeto, é necessário pesquisar. A inicialização acrescenta apenas a coluna de dados da Câmara à base existente, sem recriar registros ou arquivos. Após atualizar o código no servidor, reinicie o serviço NSSM e recarregue o navegador.

## Verificação

```powershell
npm run check
npm test
```
