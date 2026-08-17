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
- listas de áreas, responsáveis e status baseadas na aba `Parâmetros` da planilha original;
- filtros por área técnica, responsável, parecer, sugestão de emenda e posicionamento;
- busca por projeto, ementa, comissão ou responsável;
- aba de totalização filtrável, com quantidades e percentuais por área e pelos três campos de status;
- exportação protegida por senha da base completa ou filtrada em CSV compatível com Excel.

## Persistência

A base é criada automaticamente em `data/registros.sqlite`. Mantenha esse arquivo para preservar os registros. Nenhum dado é enviado para a internet.

## Verificação

```powershell
npm run check
npm test
```
