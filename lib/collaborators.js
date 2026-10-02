// Fonte: Colaboradores_confederando.xlsx, recebido em 02/10/2026.
// Apenas espaços e variantes ortográficas do mesmo setor foram unificados.
// Consultores recuperados da lista anterior, conforme solicitação de 02/10/2026.
const directory = {
  "Assistência Social": ["Brunno Trindade", "Dayane Santos", "Filipe Landim", "Vitória Jadallah"],
  "Assessoria de Comunicação": ["Allan Lima", "Erika Morais", "Giulia Soares", "Izaias Oliveira", "Joelton Oliveira", "Livia Bertanha", "Lívia Villela", "Mabilia Souza", "Marcella Camargos", "Raquel Montalvão", "Victor Gomes"],
  "Assessoria Institucional": ["Carlos Schein", "Elias Barruffe", "Marvelis Farias", "Roberto Meneghini", "Thiago Carvalho"],
  "Assessoria Parlamentar": ["André Alencar", "André Rosa", "Christopher Xavier"],
  "Canais Digitais": ["Isac Batista", "Jefferson Cardoso", "Luis Sousa", "Marco Melo"],
  "Central de Dados": ["Isaac Lacerda", "Jhonatan Pires", "João Krebs", "Luidy Santos"],
  "Compras": ["Amanda Pereira", "Carlos Coelho", "Kelly Gonçalves", "Raquel Soares", "Samantha Abreu"],
  "Consórcios": ["Augusto Fortunato"],
  "Consultor": ["Arthur Trindade", "Caroline Hoss", "Cleide Pompermaier", "Denilson Magalhães", "Eduardo Stranz", "Elena Garrido", "Elisa Schoenell", "Elisângela Fernandes", "Eudes Sippel", "Eugênio Greggianin", "Fernanda Fernandes", "Gil Castello Branco", "Guilherme Krieger", "Joanni Henrichs", "Leonardo Rolim", "Mário Nascimento", "Mário Rattes", "Mariza Abreu", "Martin Haeberlin", "Martin Schulze", "Max Aroldi", "Nancy Ramos", "Natasha Comassetto", "Paulo Caliendo", "Pedro Passos", "Priscila Kaiser", "Rafael Correa", "Ricardo Hermany", "Roberto Siegmann", "Rosângela Ribeiro", "Sabrina Souza", "Sérgio Gobetti", "Simone Macedo", "Valdery Brito", "Valtuir Nunes"],
  "Contabilidade e Orçamento": ["Marcus Santos"],
  "Contabilidade Pública": ["Leyliane Sena", "Sandoval Neto"],
  "Contratos": ["Eduardo Mello", "Jefferson Lima", "João Nascimento", "Marcella Fernandes"],
  "Controle Interno": ["Thiago Oliveira"],
  "CTAT": ["Flavia Salvador", "Matheus Marques", "Zuilla Lima"],
  "Cultura": ["Jaqueline Silva", "Pamela Santos"],
  "Defesa Civil": ["Ingrid Lima", "Johnny Liberato", "Maria Santos", "Thiago Gonçalves"],
  "Desenvolvimento": ["Felipe Borba", "Henrique Nascimento", "Marciley Coelho"],
  "Desenvolvimento Rural": ["Osni Rocha"],
  "Diretoria Administrativa": ["Eliton Honorato"],
  "E-Compras": ["Nathalia Batista", "Patrick Farias"],
  "Educação": ["Eduardo Santana", "Zacarias Sousa"],
  "Estudos Técnicos": ["Aquila Ferreira", "Carlos Silva", "Hilton Silva", "João de Sá", "Vinicius Almeida", "Wanderson Rocha"],
  "Eventos": ["Alexandra Ferreira", "Erika Lima", "Kescia Porfirio", "Stifanny Sousa"],
  "Finanças e Tributação": ["Alex Carneiro", "Eliane Henriques"],
  "Financeiro": ["Anne Oliveira", "Bruna Cardoso", "Gabriela Santos", "Gley Sousa"],
  "Gabinete do Presidente": ["Andréia Andrade", "Silvia Costa"],
  "Gestão": ["Felipe Paz", "Flavia Ferreira", "Hilary Sousa", "Jaqueline Martins", "Lais Sousa", "Luciane Pacheco", "Max Araujo", "Paulo Carvalho"],
  "Informática": ["Caio Rocha", "Nailson Brito", "William Pereira"],
  "Jurídico Administrativo": ["Kim Damasceno", "Wanderson Silva"],
  "Jurídico Técnico": ["Rodrigo Dias"],
  "Meio Ambiente": ["Ana Clara Elias", "Raquel Silva"],
  "MMM": ["Ana Albuquerque", "Júlia Braga Lentini", "Thais Lima Mendes"],
  "Obras, Transferências e Parcerias": ["Alessandra Ferreira", "Michelle Paionk"],
  "Operacional": ["Caio Souza", "Floriana Tres", "Ivonete Barbosa", "Rodrigo Barreto", "Rosangelo"],
  "Orçamento": ["Sophia Neves"],
  "Planejamento Territorial e Habitação": ["Jordan Cabral", "Karla França"],
  "Pré-Atendimento": ["Emanuel Moreira", "Ianne Lima", "Yuly Teran"],
  "Projeto Observa Políticas Públicas": ["Alexandre Santos", "Júlia Santos", "Rayane Oliveira"],
  "Recursos Humanos": ["Alice Silva", "Emilly Oliveira", "Mylena Bezerra", "Patricia Silva", "Samila Santos"],
  "Saúde": ["Ana Novais", "Lorranny Xavier", "Midya Souza", "Rita Bartole"],
  "Segurança Pública": ["Luan Guerson"],
  "Sustentabilidade": ["Beatriz Silva", "Cláudia Lima", "Renan Rocha"],
  "Transporte e Mobilidade": ["Hernany Reis", "Lucas Silva", "Milena Marques"],
  "Turismo": ["Mônica Costa"]
};

export const responsaveisPorArea = Object.freeze(Object.fromEntries(
  Object.entries(directory).sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .map(([area, names]) => [area, Object.freeze([...names].sort((a, b) => a.localeCompare(b, "pt-BR")))])
));
