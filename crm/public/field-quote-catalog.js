/**
 * Field Quote — catálogo (serviços, materiais, cômodos, extras, perguntas).
 * `pt` aparece para a equipe; `en` vai para o orçamento do cliente.
 * Preços: Tabela de Valores (por tipo de cliente); `rate` é só o valor inicial se nada casar.
 */
(function (global) {
  'use strict';

  const SERVICES = [
    { id: 'demolition', pt: 'Demolição', en: 'Floor removal', icon: '⛏', color: '#b2432a', unit: 'sq_ft', rate: 1.5, hints: ['demo', 'removal', 'remov', 'tear', 'retirada'] },
    { id: 'installation', pt: 'Instalação', en: 'Flooring installation', icon: '🪵', color: '#e8792c', unit: 'sq_ft', rate: 4, hints: ['install', 'instala', 'nail', 'glue', 'float'] },
    { id: 'sanding', pt: 'Lixa e acabamento', en: 'Sand & refinish', icon: '✨', color: '#7a5ea8', unit: 'sq_ft', rate: 3.5, hints: ['sand', 'refinish', 'screen', 'recoat', 'lixa', 'finish'] },
  ];

  /** Material supply (optional, part of installation): priced on area + waste. */
  const SUPPLY = { id: 'supply', pt: 'Material (fornecido por nós)', en: 'Flooring material', unit: 'sq_ft', rate: 4.5, hints: ['supply', 'material', 'fornec'] };

  const MATERIALS = [
    { id: 'lvp', pt: 'LVP (vinílico)', en: 'LVP', keys: ['lvp', 'vinyl', 'vinil'] },
    { id: 'solid_hardwood', pt: 'Madeira maciça', en: 'Solid hardwood', keys: ['hardwood', 'solid', 'maciç'] },
    { id: 'engineered_wood', pt: 'Madeira engenheirada', en: 'Engineered hardwood', keys: ['engineered', 'engenh'] },
    { id: 'laminate', pt: 'Laminado', en: 'Laminate', keys: ['laminate', 'lamin'] },
    { id: 'tile', pt: 'Cerâmica / porcelanato', en: 'Tile', keys: ['tile', 'porcel', 'cerâm'] },
    { id: 'carpet', pt: 'Carpete', en: 'Carpet', keys: ['carpet', 'carpete'] },
    { id: 'other', pt: 'Outro', en: 'Flooring', keys: [] },
  ];

  const PATTERNS = [
    { id: 'straight', pt: 'Reto', en: 'straight', waste: 10 },
    { id: 'diagonal', pt: 'Diagonal', en: 'diagonal', waste: 15 },
    { id: 'herringbone', pt: 'Espinha de peixe', en: 'herringbone', waste: 20 },
    { id: 'chevron', pt: 'Chevron', en: 'chevron', waste: 20 },
  ];

  const SANDING_TYPES = [
    { id: 'sand_finish', pt: 'Lixa completa + acabamento', en: 'full sand & finish' },
    { id: 'screen_coat', pt: 'Polimento + verniz (screen & coat)', en: 'screen & recoat' },
    { id: 'stain', pt: 'Troca de cor (stain)', en: 'sand, stain & finish' },
    { id: 'spot_repair', pt: 'Reparo pontual', en: 'spot repair' },
  ];

  const ROOMS = [
    { pt: 'Sala', en: 'Living room' },
    { pt: 'Cozinha', en: 'Kitchen' },
    { pt: 'Sala de jantar', en: 'Dining room' },
    { pt: 'Quarto', en: 'Bedroom', numbered: true },
    { pt: 'Suíte', en: 'Primary bedroom' },
    { pt: 'Corredor', en: 'Hallway' },
    { pt: 'Closet', en: 'Closet', numbered: true },
    { pt: 'Banheiro', en: 'Bathroom', numbered: true },
    { pt: 'Escritório', en: 'Office' },
    { pt: 'Entrada', en: 'Entryway' },
    { pt: 'Lavanderia', en: 'Laundry room' },
    { pt: 'Porão', en: 'Basement' },
  ];

  /**
   * Priced extras. qty: 'manual' | 'perimeter' (sum of room perimeters, linear ft) | 'area' (install area).
   */
  const EXTRAS = [
    { id: 'stairs', pt: 'Escada', sub: 'por degrau', en: 'Stair treads', unit: 'step', rate: 65, qty: 'manual', hints: ['stair', 'tread', 'escada', 'degrau'] },
    { id: 'baseboard_install', pt: 'Rodapé novo', sub: 'pé linear', en: 'Baseboard installation', unit: 'linear_ft', rate: 2.5, qty: 'perimeter', hints: ['baseboard', 'rodap'] },
    { id: 'baseboard_remove', pt: 'Remover e recolocar rodapé', sub: 'pé linear', en: 'Baseboard removal & reinstall', unit: 'linear_ft', rate: 1.25, qty: 'perimeter', hints: ['baseboard removal', 'remove baseboard'] },
    { id: 'quarter_round', pt: 'Quarter round', sub: 'pé linear', en: 'Quarter round', unit: 'linear_ft', rate: 1.5, qty: 'perimeter', hints: ['quarter'] },
    { id: 'transitions', pt: 'Transições / soleiras', sub: 'unidade', en: 'Transition strips', unit: 'each', rate: 35, qty: 'manual', hints: ['transition', 'threshold', 'soleira'] },
    { id: 'underlayment', pt: 'Manta (underlayment)', sub: 'pé²', en: 'Underlayment', unit: 'sq_ft', rate: 0.75, qty: 'area', hints: ['underlay', 'manta', 'pad'] },
    { id: 'moisture', pt: 'Barreira de umidade', sub: 'pé²', en: 'Moisture barrier', unit: 'sq_ft', rate: 0.5, qty: 'area', hints: ['moisture', 'umidade', 'vapor'] },
    { id: 'leveling', pt: 'Nivelamento do contrapiso', sub: 'pé²', en: 'Subfloor leveling', unit: 'sq_ft', rate: 2, qty: 'manual', hints: ['level', 'nivel', 'self-level'] },
    { id: 'furniture', pt: 'Mover móveis', sub: 'valor fixo', en: 'Furniture moving', unit: 'fixed', rate: 150, qty: 'manual', hints: ['furniture', 'móve', 'move'] },
    { id: 'haul_away', pt: 'Descarte / caçamba', sub: 'valor fixo', en: 'Haul away & disposal', unit: 'fixed', rate: 350, qty: 'manual', hints: ['haul', 'disposal', 'dumpster', 'descarte'] },
  ];

  /** Details asked on site (not priced). Grouped by service; `show` gates by previous answers. */
  const QUESTIONS = {
    general: [
      { id: 'occupied', pt: 'Casa ocupada durante a obra?', type: 'bool' },
      { id: 'pets', pt: 'Tem pets?', type: 'bool', attention: 'Pets na casa' },
      { id: 'access', pt: 'Acesso / estacionamento', type: 'text', attention: 'Acesso' },
      { id: 'heavy_items', pt: 'Móveis pesados (piano, cofre…)', type: 'text', attention: 'Móveis pesados' },
      { id: 'timeline', pt: 'Quando o cliente quer começar?', type: 'text' },
    ],
    demolition: [
      { id: 'existing', pt: 'Piso que sai', type: 'multi', options: ['carpet', 'lvp', 'solid_hardwood', 'engineered_wood', 'laminate', 'tile', 'other'] },
      { id: 'carpet_pad', pt: 'Remover manta e tack strip?', type: 'bool', show: (a) => (a.demolition.existing || []).includes('carpet') },
      { id: 'wood_fastening', pt: 'Como está fixado?', type: 'choice', options: [['glued', 'Colado'], ['nailed', 'Pregado'], ['floating', 'Flutuante']], show: (a) => (a.demolition.existing || []).some((m) => ['solid_hardwood', 'engineered_wood', 'laminate', 'lvp'].includes(m)) },
      { id: 'layers', pt: 'Camadas de piso', type: 'number', show: (a) => (a.demolition.existing || []).length > 0 },
      { id: 'thinset', pt: 'Tirar argamassa (thinset)?', type: 'bool', show: (a) => (a.demolition.existing || []).includes('tile') },
      { id: 'subfloor', pt: 'Contrapiso', type: 'choice', options: [['plywood', 'Compensado'], ['concrete', 'Concreto'], ['unknown', 'Não sei']] },
    ],
    installation: [
      { id: 'method', pt: 'Método', type: 'choice', options: [['nailed', 'Pregado'], ['glued', 'Colado'], ['floating', 'Flutuante / click']] },
      { id: 'board_width', pt: 'Largura da tábua', type: 'text', show: (a, s) => ['solid_hardwood', 'engineered_wood', 'lvp', 'laminate'].includes(s.installation && s.installation.material) },
      { id: 'direction', pt: 'Direção da instalação', type: 'text', attention: 'Direção' },
      { id: 'tile_size', pt: 'Tamanho da peça / rejunte', type: 'text', show: (a, s) => (s.installation && s.installation.material) === 'tile' },
    ],
    sanding: [
      { id: 'coats', pt: 'Demãos de acabamento', type: 'number' },
      { id: 'finish', pt: 'Acabamento', type: 'choice', options: [['water', 'Base d’água'], ['oil', 'Base óleo']] },
      { id: 'sheen', pt: 'Brilho', type: 'choice', options: [['matte', 'Fosco'], ['satin', 'Acetinado'], ['semi', 'Semibrilho'], ['gloss', 'Brilho']] },
      { id: 'stain_color', pt: 'Cor do stain / amostra', type: 'text', show: (a, s) => (s.sanding && s.sanding.type) === 'stain', attention: 'Cor' },
      { id: 'boards_repair', pt: 'Tábuas para trocar (estimativa)', type: 'number' },
    ],
  };

  const CUSTOMER_TYPES = [
    { id: 'particular', pt: 'Particular' },
    { id: 'builder', pt: 'Builder' },
    { id: 'contractor', pt: 'Contractor' },
    { id: 'loja', pt: 'Loja' },
  ];

  const UNIT_PT = { sq_ft: 'pé²', linear_ft: 'pé lin.', step: 'degrau', each: 'un.', fixed: 'fixo' };
  const UNIT_EN = { sq_ft: 'sq ft', linear_ft: 'lin ft', step: 'steps', each: 'ea', fixed: '' };

  global.FQ_CATALOG = { SERVICES, SUPPLY, MATERIALS, PATTERNS, SANDING_TYPES, ROOMS, EXTRAS, QUESTIONS, CUSTOMER_TYPES, UNIT_PT, UNIT_EN };
})(window);
