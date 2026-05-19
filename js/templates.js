// templates.js — NL→SPARQL por templates (CoP CT&I-PE).
// 8 intents incluindo busca de docente por nome (substitui a seção #buscar).

const PREFIX = 'PREFIX cti: <http://gic.ufrpe.br/cti/vocabulary/cti#>';

function findIct(q) {
  const m = q.toUpperCase().match(/\b(UFRPE|UFPE|UPE)\b/);
  return m ? m[1] : null;
}

function findN(q, fallback) {
  const m = q.match(/\b(\d{1,3})\b/);
  return m ? parseInt(m[1], 10) : fallback;
}

function findAfter(q, kws) {
  for (const kw of kws) {
    const re = new RegExp(
      `(?:${kw})\\s+(?:de\\s+|da\\s+|do\\s+|em\\s+)?["']?([^"'?.!]+?)["']?\\s*[?.!]?\\s*$`,
      'i'
    );
    const m = q.match(re);
    if (m && m[1] && m[1].trim().length >= 3) return m[1].trim().toUpperCase();
  }
  return null;
}

function ictClause(ict, { withPpg = false } = {}) {
  if (!ict) return '';
  if (withPpg) {
    return `?ppg cti:sediado_em ?_ict . ?_ict cti:sg_entidade_ensino "${ict}" .`;
  }
  return `?docente cti:vinculado_a ?_ppg . ?_ppg cti:sediado_em ?_ict . ?_ict cti:sg_entidade_ensino "${ict}" .`;
}

function anyKw(q, words) {
  const ql = q.toLowerCase();
  return words.some(w => ql.includes(w));
}

// Termos que indicam uma "pergunta analítica" — usados pra negar o fallback
// de busca-por-nome (a intent default não deve agarrar perguntas tipo
// "qual a média de h-index").
const ANALYTIC_HINTS = /[?]|qual|quais|como|onde|quantos|quantas|m[ée]di|impacto|cita|h-?index|h\s+index|carreira|top|maior|ranking|comparar|interdis|permanente|colaborador|\bppg\b|programa|[áa]rea/i;

const INTENTS = [
  {
    id: 'carreira-vs-impacto',
    title: 'Carreira × Impacto',
    examples: [
      'carreira vs impacto',
      'tempo de doutorado vs h-index',
      'relação entre carreira e citações na UFRPE',
    ],
    match(q) {
      const ok =
        anyKw(q, ['carreira', 'doutorado', 'tempo']) &&
        anyKw(q, ['impacto', 'h-index', 'hindex', 'h index', 'cita']);
      return ok ? { slots: { ict: findIct(q) } } : null;
    },
    build({ slots }) {
      return `${PREFIX}
SELECT ?nome (2026 - ?an_titulacao AS ?anos_carreira) ?h_index ?citation_count ?document_count ?categoria
WHERE {
  ?docente a cti:Docente ;
           cti:nm_docente      ?nome ;
           cti:an_titulacao    ?an_titulacao ;
           cti:ds_categoria    ?categoria ;
           cti:citation_count  ?citation_count ;
           cti:h_index         ?h_index ;
           cti:document_count  ?document_count .
  ${ictClause(slots.ict)}
  FILTER (?an_titulacao > 0)
}
ORDER BY DESC(?h_index) DESC(?citation_count)
LIMIT 100`;
    },
  },

  {
    id: 'top-h-index',
    title: 'Top N por h-index',
    examples: [
      'top 20 por h-index',
      'maiores h-index da UFPE',
      'top 10 docentes da UPE por h',
    ],
    match(q) {
      const ok =
        (anyKw(q, ['top', 'maiores', 'maior', 'ranking']) &&
          anyKw(q, ['h-index', 'hindex', 'h index', ' h ', 'índice h'])) ||
        /maiores?\s+h(-?index|\s+index)?/i.test(q);
      return ok ? { slots: { n: findN(q, 20), ict: findIct(q) } } : null;
    },
    build({ slots }) {
      return `${PREFIX}
SELECT ?nome ?h_index ?citation_count
       (2026 - ?an_titulacao AS ?anos_carreira)
       (GROUP_CONCAT(DISTINCT ?nm_programa ; separator=" | ") AS ?ppgs)
WHERE {
  ?docente a cti:Docente ;
           cti:nm_docente     ?nome ;
           cti:an_titulacao   ?an_titulacao ;
           cti:h_index        ?h_index ;
           cti:citation_count ?citation_count ;
           cti:vinculado_a    ?ppg .
  ?ppg cti:nm_programa_ies ?nm_programa .
  ${ictClause(slots.ict, { withPpg: true })}
  FILTER (?an_titulacao > 0)
}
GROUP BY ?nome ?h_index ?citation_count ?an_titulacao
ORDER BY DESC(?h_index) DESC(?citation_count)
LIMIT ${slots.n}`;
    },
  },

  {
    id: 'impacto-por-area',
    title: 'Impacto médio por área',
    examples: [
      'impacto médio por área',
      'h-index médio por área de conhecimento',
      'ranking de áreas por citações',
    ],
    match(q) {
      const ok =
        anyKw(q, ['área', 'area', 'áreas', 'areas']) &&
        anyKw(q, ['impacto', 'média', 'media', 'h-index', 'hindex', 'cita', 'ranking']);
      return ok ? { slots: { ict: findIct(q) } } : null;
    },
    build({ slots }) {
      return `${PREFIX}
SELECT ?area
       (COUNT(DISTINCT ?docente) AS ?num_docentes)
       (AVG(?h_index)         AS ?media_h)
       (MAX(?h_index)         AS ?max_h)
       (AVG(?citation_count)  AS ?media_citacoes)
       (SUM(?document_count)  AS ?total_documentos)
WHERE {
  ?docente a cti:Docente ;
           cti:vinculado_a    ?ppg ;
           cti:h_index        ?h_index ;
           cti:citation_count ?citation_count ;
           cti:document_count ?document_count .
  ?ppg cti:nm_area_conhecimento ?area .
  ${ictClause(slots.ict, { withPpg: true })}
}
GROUP BY ?area
HAVING (COUNT(DISTINCT ?docente) >= 5)
ORDER BY DESC(?media_h)`;
    },
  },

  {
    id: 'permanentes-vs-colaboradores',
    title: 'Permanentes vs Colaboradores',
    examples: [
      'permanentes vs colaboradores',
      'comparar permanentes e colaboradores na UFRPE',
    ],
    match(q) {
      const ok = anyKw(q, ['permanente']) && anyKw(q, ['colaborador']);
      return ok ? { slots: { ict: findIct(q) } } : null;
    },
    build({ slots }) {
      return `${PREFIX}
SELECT ?categoria
       (COUNT(?docente)           AS ?n_docentes)
       (AVG(?h_index)             AS ?media_h)
       (AVG(?citation_count)      AS ?media_citacoes)
       (AVG(?document_count)      AS ?media_documentos)
       (AVG(2026 - ?an_titulacao) AS ?media_anos_carreira)
WHERE {
  ?docente a cti:Docente ;
           cti:ds_categoria   ?categoria ;
           cti:an_titulacao   ?an_titulacao ;
           cti:h_index        ?h_index ;
           cti:citation_count ?citation_count ;
           cti:document_count ?document_count .
  ${ictClause(slots.ict)}
  FILTER (?an_titulacao > 0)
}
GROUP BY ?categoria
ORDER BY ?categoria`;
    },
  },

  {
    id: 'interdisciplinaridade',
    title: 'Docentes interdisciplinares (em N+ PPGs)',
    examples: [
      'docentes em mais de um PPG',
      'interdisciplinares',
      'quem atua em vários PPGs',
    ],
    match(q) {
      const ql = q.toLowerCase();
      const ok =
        ql.includes('interdis') ||
        /mais\s+de\s+um\s+ppg/.test(ql) ||
        (anyKw(q, ['vários', 'varios', 'múltiplos', 'multiplos']) &&
          anyKw(q, ['ppg', 'programa']));
      return ok ? { slots: { ict: findIct(q) } } : null;
    },
    build({ slots }) {
      return `${PREFIX}
SELECT ?nome
       (COUNT(DISTINCT ?ppg)  AS ?num_ppgs)
       (COUNT(DISTINCT ?area) AS ?num_areas)
       ?h_index ?citation_count
       (GROUP_CONCAT(DISTINCT ?area ; separator=" | ") AS ?areas)
WHERE {
  ?docente a cti:Docente ;
           cti:nm_docente     ?nome ;
           cti:h_index        ?h_index ;
           cti:citation_count ?citation_count ;
           cti:vinculado_a    ?ppg .
  ?ppg cti:nm_area_conhecimento ?area .
  ${ictClause(slots.ict, { withPpg: true })}
}
GROUP BY ?nome ?h_index ?citation_count
HAVING (COUNT(DISTINCT ?ppg) >= 2)
ORDER BY DESC(?num_ppgs) DESC(?h_index)
LIMIT 30`;
    },
  },

  {
    id: 'docentes-do-ppg',
    title: 'Docentes de um PPG específico',
    examples: [
      'docentes do PPG de Ciência da Computação',
      'quem está no programa de Etnobiologia',
      'docentes do PPG Filosofia',
    ],
    match(q) {
      if (!anyKw(q, ['docente', 'quem', 'pesquisador'])) return null;
      const ppg = findAfter(q, [
        'do ppg', 'no ppg', 'do programa', 'no programa', 'ppg de', 'ppg', 'programa de',
      ]);
      return ppg ? { slots: { ppg } } : null;
    },
    build({ slots }) {
      return `${PREFIX}
SELECT ?nome ?h_index ?citation_count ?categoria ?nm_programa
WHERE {
  ?docente a cti:Docente ;
           cti:nm_docente     ?nome ;
           cti:ds_categoria   ?categoria ;
           cti:h_index        ?h_index ;
           cti:citation_count ?citation_count ;
           cti:vinculado_a    ?ppg .
  ?ppg cti:nm_programa_ies ?nm_programa .
  FILTER (CONTAINS(UCASE(?nm_programa), "${slots.ppg}"))
}
ORDER BY DESC(?h_index) DESC(?citation_count)
LIMIT 100`;
    },
  },

  {
    id: 'ppgs-da-area',
    title: 'PPGs de uma área',
    examples: [
      'PPGs da área de Educação',
      'programas da área Ciência da Computação',
      'PPGs de Biotecnologia',
    ],
    match(q) {
      if (!anyKw(q, ['ppg', 'programa'])) return null;
      const area = findAfter(q, [
        'área de', 'area de', 'da área', 'da area', 'área', 'area', 'de',
      ]);
      return area ? { slots: { area } } : null;
    },
    build({ slots }) {
      return `${PREFIX}
SELECT ?nm_programa ?sigla_ict (COUNT(DISTINCT ?docente) AS ?n_docentes)
WHERE {
  ?ppg a cti:PPG ;
       cti:nm_programa_ies      ?nm_programa ;
       cti:nm_area_conhecimento ?area ;
       cti:sediado_em           ?ict .
  ?ict cti:sg_entidade_ensino ?sigla_ict .
  OPTIONAL { ?docente a cti:Docente ; cti:vinculado_a ?ppg . }
  FILTER (CONTAINS(UCASE(?area), "${slots.area}"))
}
GROUP BY ?nm_programa ?sigla_ict
ORDER BY DESC(?n_docentes) ?nm_programa`;
    },
  },

  // FALLBACK — sempre por último. Busca por nome: aceita "buscar X" / "quem é X"
  // explícitos ou query curta que pareça um nome.
  {
    id: 'busca-docente',
    title: 'Buscar docente por nome',
    examples: ['MARTINELLI', 'buscar ARNAUD', 'quem é SOPHIE'],
    match(q) {
      const explicit = findAfter(q, [
        'buscar', 'procurar', 'encontrar', 'achar',
        'quem é', 'quem e', 'docente chamado', 'docentes com nome',
        'docentes chamados',
      ]);
      if (explicit) return { slots: { nome: explicit } };

      // Query curta (1–4 palavras), só letras, sem termos analíticos.
      const trimmed = q.trim();
      const words = trimmed.split(/\s+/);
      if (words.length < 1 || words.length > 4) return null;
      if (ANALYTIC_HINTS.test(trimmed)) return null;
      if (!/^[a-záàâãéèêíïóôõúüç\s\-']{3,}$/i.test(trimmed)) return null;
      return { slots: { nome: trimmed.toUpperCase() } };
    },
    build({ slots }) {
      return `${PREFIX}
SELECT ?nome ?h_index ?citation_count ?categoria ?nm_programa ?sigla_ict
WHERE {
  ?docente a cti:Docente ;
           cti:nm_docente     ?nome ;
           cti:ds_categoria   ?categoria ;
           cti:h_index        ?h_index ;
           cti:citation_count ?citation_count ;
           cti:vinculado_a    ?ppg .
  ?ppg cti:nm_programa_ies ?nm_programa ;
       cti:sediado_em      ?ict .
  ?ict cti:sg_entidade_ensino ?sigla_ict .
  FILTER (CONTAINS(UCASE(?nome), "${slots.nome}"))
}
ORDER BY DESC(?h_index) DESC(?citation_count)
LIMIT 100`;
    },
  },
];

export function matchQuestion(q) {
  for (const intent of INTENTS) {
    const m = intent.match(q);
    if (m) return { intent, slots: m.slots };
  }
  return null;
}

export function listIntents() {
  return INTENTS.map(i => ({ id: i.id, title: i.title, examples: i.examples }));
}
