# Leis de UX do ObraMate

Este é o padrão de UX obrigatório para qualquer desenvolvimento neste repositório: telas, componentes, fluxos, textos, mensagens de erro, notificações e também as APIs e validações de backend que moldam o que a pessoa vê.

A versão compacta está no [`CLAUDE.md`](../CLAUDE.md). Este documento é a referência completa: explica cada lei, por que ela funciona, o que fazer na prática e onde ela deixa de valer.

## Como ler as regras

Cada lei tem cinco partes:

- **O que diz:** a ideia, com a origem quando ela ajuda a entender.
- **Por que importa:** o que acontece com a pessoa quando a lei é ignorada.
- **Regras:** o que é exigido ao desenvolver aqui.
- **No ObraMate:** como a lei se aplica aos nossos produtos.
- **Limite:** onde a lei é mal usada ou deixa de valer.

As leis descrevem tendências do comportamento humano, não fatos exatos. **Os números nas regras (5 destinos, 44 px, 400 ms) são padrões definidos para este projeto, não valores que as leis determinam**, exceto quando a fonte é citada. Eles podem ser ultrapassados com um motivo concreto, registrado na entrega.

## Para quem projetamos

| Superfície | Quem usa | Contexto que muda as decisões |
|---|---|---|
| **ObraMate CRM** | Dono, escritório e vendas de empresas de pisos | Uso longo e repetido, em desktop e no celular, com muitos dados |
| **Campo, ObraCam e Obra Crew** | Instaladores e equipes de obra | Celular, uma mão, luz forte, mãos sujas, conexão ruim, pressa |
| **Portal ObraBuilder** | Builders que trabalham com várias empresas | Uso esporádico, sem treinamento, e várias empresas na mesma conta |
| **Admin da plataforma** | Equipe interna | Ações de alto impacto entre vários tenants |

Antes de aplicar qualquer lei, identifique a superfície. A mesma tela pode pedir densidade no CRM e simplicidade extrema no Campo.

## Resumo das 18 leis

| # | Lei | Em uma frase |
|---|---|---|
| 1 | Lei de Hick | Mais opções significam decisão mais lenta. |
| 2 | Lei de Fitts | Alvos grandes e próximos são mais rápidos e seguros. |
| 3 | Lei de Jakob | As pessoas esperam que isto funcione como tudo que já conhecem. |
| 4 | Lei da Proximidade | O que está perto parece relacionado. |
| 5 | Lei de Miller | A memória de trabalho é curta, então agrupe e mostre. |
| 6 | Limiar de Doherty | Resposta abaixo de 400 ms mantém a pessoa no fluxo. |
| 7 | Efeito Von Restorff | O diferente é lembrado, então destaque só o que importa. |
| 8 | Efeito de posição serial | Primeiro e último itens são os mais lembrados. |
| 9 | Regra do pico-fim | A experiência é julgada pelo momento mais intenso e pelo final. |
| 10 | Efeito Zeigarnik | Tarefa inacabada fica na cabeça, então mostre o que falta. |
| 11 | Lei de Prägnanz | Formas complexas são lidas da maneira mais simples possível. |
| 12 | Lei da Semelhança | O que parece igual é entendido como igual. |
| 13 | Conectividade Uniforme | Elementos visualmente conectados formam um grupo forte. |
| 14 | Lei de Tesler | A complexidade não some, alguém precisa absorvê-la. |
| 15 | Lei de Postel | Aceite entradas variadas e devolva saídas rigorosas. |
| 16 | Lei de Parkinson | A tarefa ocupa todo o tempo disponível, então encurte-a. |
| 17 | Navalha de Occam | Entre soluções equivalentes, escolha a mais simples. |
| 18 | Princípio de Pareto | Poucos fluxos geram a maior parte do valor. |

---

## 1. Lei de Hick

**O que diz:** o tempo para decidir aumenta com o número e a complexidade das opções. Hick e Hyman descreveram isso em 1952, com crescimento logarítmico: `T = b · log₂(n + 1)`.

**Por que importa:** cada opção a mais é mais uma coisa a avaliar. O resultado é hesitação, erro, abandono ou a pessoa pedir ajuda a outra.

**Regras:**

- Cada tela tem **uma ação primária** evidente. As demais ficam visualmente secundárias.
- A navegação principal tem até **5 destinos** no celular. O restante vai para "Mais".
- Listas longas usam busca, filtro ou agrupamento, em vez de exigir leitura item a item. Selects com mais de cerca de 10 opções ganham busca.
- Fluxos com muitas decisões são divididos em etapas, cada uma com uma decisão.
- Use divulgação progressiva: opções avançadas ficam recolhidas até serem necessárias.
- Ofereça um padrão sensato já selecionado sempre que existir uma resposta provável.

**No ObraMate:** a navegação do portal ObraBuilder foi reduzida a Home, Jobs, Calendar, Invoices e More, e os destinos menos usados ficam em More. Esse é o modelo a seguir ao adicionar um novo destino: ele entra em More, a não ser que substitua um dos principais.

**Limite:** a lei vale para escolher entre opções, não para procurar algo conhecido em uma lista bem ordenada. Reduzir opções também não pode esconder o que é usado com frequência: seis cliques simples podem ser piores que uma tela com dez opções bem organizadas.

---

## 2. Lei de Fitts

**O que diz:** o tempo para alcançar um alvo depende da distância até ele e do seu tamanho. Fitts publicou a relação em 1954: `T = a + b · log₂(2D / L)`. Alvos pequenos e distantes são mais lentos e geram mais erros.

**Por que importa:** toque errado em obra custa caro: abre a tela errada, liga para o cliente errado ou apaga algo por engano.

**Regras:**

- Alvos de toque têm no mínimo **44 × 44 px** (critério AAA de WCAG 2.5.5). O mínimo absoluto de WCAG 2.5.8 é 24 px, mas não é o padrão aqui.
- No Campo, Obra Crew e ObraCam, a ação principal tem **pelo menos 48 px** de altura e fica na zona do polegar, na parte de baixo da tela.
- Mantenha **pelo menos 8 px** entre alvos vizinhos.
- Se o ícone for pequeno, aumente a área clicável com padding, sem aumentar o ícone.
- Campos de formulário têm rótulo clicável. A linha inteira de uma lista é clicável quando leva a um único destino.
- A ação fica perto do que ela afeta: salvar perto do formulário, editar perto do item.
- Ações destrutivas ficam longe das ações frequentes e nunca ao lado do botão primário sem separação clara.
- No desktop, aproveite bordas da tela e menus de contexto, que encurtam o movimento.

**No ObraMate:** o `crm/public/campo/campo.css` já usa alvos de 44 e 48 px em vários pontos. Ao tocar nessa superfície, mantenha esse padrão e corrija valores menores, como o `min-height: 40px` que ainda existe no arquivo, quando forem alvos de toque.

**Limite:** tamanho não resolve hierarquia. Se tudo for grande, nada se destaca. Em tabelas densas de desktop, alvos menores são aceitáveis para uso com mouse, desde que a mesma tela não seja usada por toque.

---

## 3. Lei de Jakob

**O que diz:** as pessoas passam a maior parte do tempo em outros produtos, por isso esperam que o seu funcione como os que já conhecem. Jakob Nielsen formulou essa observação em 2000.

**Por que importa:** seguir uma convenção não exige aprendizado. Quebrá-la faz a pessoa gastar atenção na interface, e não no trabalho.

**Regras:**

- Use convenções da plataforma: voltar no canto superior esquerdo no celular, fechar modal com `Esc` e clicando fora (sem dados não salvos), logo levando à Home.
- Use controles nativos e tipos de input corretos: `type="tel"`, `type="email"`, `inputmode="decimal"`, `autocomplete`. O teclado certo aparece sem esforço.
- Links abrem navegação, botões executam ações. Não troque os papéis.
- Ícones seguem o sentido comum: lixeira apaga, lápis edita, lupa busca.
- Dentro do produto, a convenção é a nossa: um padrão já estabelecido no ObraMate vence uma preferência nova.
- Ao substituir uma tela usada no dia a dia, preserve os caminhos que as pessoas já têm na memória ou dê um período de transição.

**No ObraMate:** a ação de mapa em um Job deve abrir o app de mapas do telefone com o endereço já preenchido, e um telefone na tela deve ser tocável para ligar. A pessoa já espera os dois comportamentos.

**Limite:** a lei não proíbe inovar, ela pede que a inovação compense o custo de aprendizado. E convenção ruim não vira boa por ser comum. **Regra do repositório:** nunca cite nomes de concorrentes ou produtos de referência em código, documentos, commits ou PRs. Descreva o padrão em termos do nosso produto.

---

## 4. Lei da Proximidade

**O que diz:** elementos próximos são percebidos como relacionados. É um dos princípios da Gestalt, descritos por psicólogos alemães no início do século XX.

**Por que importa:** o espaço comunica estrutura antes de qualquer palavra ser lida. Espaçamento uniforme faz a tela parecer uma lista sem organização, e a pessoa não percebe o que pertence a quê.

**Regras:**

- O espaço **dentro** de um grupo é sempre menor que o espaço **entre** grupos. Uma proporção de cerca de 1:2 é um bom ponto de partida.
- O rótulo fica mais perto do seu campo do que do campo anterior.
- O texto de ajuda e o erro ficam junto do campo a que se referem, não no topo da página.
- Ações de um item ficam visualmente dentro do item.
- Use espaço para separar antes de recorrer a linhas ou caixas.
- Use a escala de espaçamento existente, sem valores improvisados.

**No ObraMate:** em um card de Job, nome do cliente e endereço formam um bloco, data e horário outro, e a ação de mapa fica junto do endereço, porque é sobre ele que ela age.

**Limite:** em telas pequenas o espaço acaba. Quando isso acontecer, use também títulos de seção ou contêineres (leis 12 e 13), em vez de comprimir tudo por igual.

---

## 5. Lei de Miller

**O que diz:** em 1956, George Miller observou que retemos cerca de 7 ± 2 itens na memória de curto prazo. Pesquisas posteriores sugerem um limite ainda menor, de cerca de 4 blocos. O ponto central é o **agrupamento**: muitos itens viram poucos blocos significativos.

**Por que importa:** quando a interface exige lembrar de um dado de uma tela para usar em outra, ela provoca erros e obriga a pessoa a anotar ou a voltar.

**Regras:**

- Agrupe informações longas: telefone como `(303) 555-0142`, e valores com separador de milhar.
- Divida formulários longos em seções com título.
- **Mostre, não peça para lembrar:** mantenha cliente, Job e valor visíveis durante o fluxo em que são relevantes.
- Ao ir de uma etapa para outra, leve o contexto junto, com campos pré-preenchidos.
- Em tabelas, mostre por padrão as colunas que apoiam a decisão e deixe o restante acessível sob demanda.

**No ObraMate:** um instalador registrando horas ou fotos deve ver o nome do cliente e o endereço no topo da tela, sem precisar voltar para confirmar em qual Job está.

**Limite:** o erro mais comum é tratar a lei como "menus só podem ter 7 itens". Ela fala do que é preciso **reter na memória**, não do que está à vista. Um menu que se pode reler não exige memória. Para limitar opções, use a Lei de Hick.

---

## 6. Limiar de Doherty

**O que diz:** a produtividade sobe bastante quando o sistema responde em menos de cerca de 400 ms, porque a pessoa não perde o fio do pensamento. Doherty e Thadani, da IBM, publicaram esse resultado em 1982.

**Por que importa:** sem resposta rápida, a pessoa toca de novo, duvida se funcionou ou muda de tarefa. No nosso caso, toque duplicado pode virar registro duplicado.

**Regras:**

| Tempo da operação | O que mostrar |
|---|---|
| Até cerca de 100 ms | Resposta imediata ao toque (estado pressionado, foco). Sempre. |
| Até 400 ms | Resultado final. É a meta para interações frequentes. |
| De 400 ms a 1 s | Skeleton com o formato do conteúdo, ou spinner no próprio botão. |
| De 1 s a 10 s | Mensagem do que está acontecendo, com progresso quando for possível medir. |
| Mais de 10 s | Trabalho em segundo plano, progresso real e aviso quando terminar. |

- Botões de envio mostram carregamento e ficam desabilitados durante a requisição. O backend é idempotente quando duplicar causa dano.
- Use interface otimista só para ações frequentes e fáceis de reverter. Se falhar, restaure o estado e avise. Nunca a use para pagamento, envio ao cliente ou exclusão.
- Pagine ou virtualize listas longas e evite N+1 em endpoints de lista.
- Skeletons preservam o layout final para a tela não pular.
- Animações de interface ficam abaixo de cerca de 300 ms e respeitam `prefers-reduced-motion`. Animação nunca atrasa uma ação frequente.
- Toda operação assíncrona tem estados de carregamento, sucesso, vazio e erro.

**No ObraMate:** o Campo tem fila de envio de mídia (`crm/public/campo/campo-media-queue.js`). Foto registrada em obra deve dar confirmação local imediata, e o upload segue em segundo plano. "Salvo no aparelho" e "enviado" são estados diferentes e devem aparecer como tal.

**Limite:** uma animação longa ou um progresso falso não tornam nada mais rápido. Não simule velocidade dizendo que algo foi salvo antes de estar salvo, porque em conexão ruim isso significa perder o trabalho de alguém.

---

## 7. Efeito Von Restorff

**O que diz:** entre itens parecidos, o diferente é o mais lembrado. Também é chamado de efeito de isolamento, e foi descrito por Hedwig von Restorff em 1933.

**Por que importa:** é assim que se direciona a atenção. Mas ele só funciona enquanto o destaque for raro: quando tudo se destaca, nada se destaca.

**Regras:**

- Reserve o destaque mais forte para **um** elemento por área: o botão primário ou o alerta que exige ação.
- Vermelho e laranja representam risco ou atraso real, nunca decoração.
- **Nunca use só cor** para transmitir significado (WCAG 1.4.1). Combine com ícone, texto ou forma, e lembre que a luz forte da obra reduz o contraste.
- Destaque o que exige decisão: fatura vencida, Job sem data, conflito de agenda.
- Evite que cada card da tela tenha seu próprio badge colorido.
- Movimento chama muita atenção. Use apenas em mudanças de estado relevantes, nunca em loop decorativo.

**No ObraMate:** em Invoices, a fatura vencida é o que deve saltar aos olhos. Se pagas, em aberto e rascunho competirem pela mesma intensidade de cor, o sinal se perde.

**Limite:** não destaque o que beneficia o negócio em prejuízo da pessoa, como um botão "aceitar" chamativo ao lado de um "recusar" escondido. Isso é um padrão enganoso e não é permitido aqui.

---

## 8. Efeito de posição serial

**O que diz:** em uma sequência, lembramos melhor do início (efeito de primazia) e do fim (efeito de recência), e o meio tende a ser esquecido. Vem dos estudos de memória de Ebbinghaus.

**Por que importa:** a posição decide o que é visto e lembrado. Colocar o importante no meio de uma lista é uma forma silenciosa de escondê-lo.

**Regras:**

- Em navegação e menus, os destinos mais importantes ficam no início e no fim. "Mais" ou "Conta" vão no final.
- Em listas de ação, a ação mais comum vem primeiro e a destrutiva fica por último, separada.
- Em textos e notificações, comece pela informação essencial: "Fatura #123 vencida há 5 dias", não "Informamos que, conforme registros...".
- Em formulários, as colunas e os campos mais importantes vêm primeiro.
- Em tabelas, a primeira coluna identifica o item e a última traz o status ou a ação.
- No resumo de um fluxo, termine com o que acontece a seguir.

**No ObraMate:** a barra do ObraBuilder começa em Home e termina em More, e Jobs e Calendar ficam em posições fáceis de encontrar. Ao adicionar itens, não empurre as tarefas principais para o meio.

**Limite:** a ordem deve vir do uso real, não só dessa regra. Em listas onde a ordem tem sentido próprio, como datas ou ordem alfabética, mantenha esse sentido e não reordene por importância.

---

## 9. Regra do pico-fim

**O que diz:** julgamos uma experiência principalmente pelo seu momento mais intenso e pelo seu final, não pela média. Kahneman e colegas demonstraram isso nos anos 1990.

**Por que importa:** um fluxo inteiro correto pode ser lembrado como ruim por causa de um único erro que apagou dados. Também pode ser lembrado como bom por terminar com clareza.

**Regras:**

- Identifique o pico de cada fluxo, positivo ou negativo, e dedique cuidado a ele.
- **Todo fluxo termina com confirmação clara**: o que aconteceu e qual é o próximo passo. Nunca devolva a pessoa a uma tela genérica sem aviso.
- **Mensagens de erro** dizem o que aconteceu, por quê e como resolver. Nunca exibem texto técnico como `Error 500` ou um stack trace.
- **Nunca perca o que a pessoa digitou.** Em erro de validação ou de rede, os dados permanecem no formulário.
- Prefira desfazer a pedir confirmação, quando a ação for reversível. Confirme apenas o que for irreversível.
- Estados vazios explicam o que aparecerá ali e oferecem a próxima ação.
- Reserve celebração para marcos raros e reais. Uma tarefa de rotina recebe uma confirmação discreta.

**No ObraMate:** enviar um orçamento, receber um pagamento, concluir um Job e o primeiro acesso de um Builder são momentos de pico. Uma tela final "Orçamento enviado para cliente@exemplo.com. Avisaremos quando for aberto" vale mais que polir cinco etapas intermediárias.

**Limite:** um bom final não compensa etapas confusas ou lentas e não pode esconder problemas. Também não vale para quem usa o sistema o dia todo, para quem a consistência pesa mais que qualquer momento especial.

---

## 10. Efeito Zeigarnik

**O que diz:** tendemos a lembrar de tarefas interrompidas ou inacabadas mais do que de tarefas concluídas. Bluma Zeigarnik descreveu isso nos anos 1920. As tentativas de replicar o efeito têm resultados mistos, mas o princípio prático continua útil: **uma pendência visível ajuda a retomar o trabalho**.

**Por que importa:** o trabalho em obra e no escritório é interrompido o tempo todo. A interface precisa guardar o que ficou pela metade e mostrar o caminho de volta.

**Regras:**

- Salve rascunhos automaticamente em formulários longos e permita retomar de onde parou.
- Mostre o progresso em fluxos de várias etapas ("Etapa 2 de 4").
- Listas de início mostram itens concluídos e o que falta, com o próximo passo claro.
- Comece o progresso de forma honesta. Mostre o que já foi realmente concluído.
- Mantenha tudo pendente em um lugar previsível, com contagens corretas.
- Ao concluir, limpe o sinal de pendência. Um badge que não some treina a pessoa a ignorá-lo.

**No ObraMate:** um ticket de campo iniciado e interrompido por uma ligação deve estar intacto quando o instalador voltar, com sinal claro de que falta enviar. A Home do Builder pode mostrar o checklist de início com os itens ainda abertos.

**Limite:** não fabrique ansiedade. Contadores artificiais, urgência falsa e notificações para puxar a pessoa de volta são padrões enganosos e não são permitidos. Pendência só aparece se existir uma ação real a fazer.

---

## 11. Lei de Prägnanz

**O que diz:** tendemos a interpretar formas complexas ou ambíguas da maneira mais simples possível. É a lei central da Gestalt, também chamada de lei da boa forma.

**Por que importa:** olhos e cérebro buscam ordem. Uma interface com formas regulares e alinhadas é entendida num relance. Uma cheia de exceções visuais exige leitura de cada parte.

**Regras:**

- Alinhe a uma grade. Evite alinhamentos quase corretos, que parecem erro.
- Mantenha poucos tamanhos de texto, pesos, raios de borda e sombras, sempre vindos da escala existente.
- Use ícones simples e reconhecíveis, sempre no mesmo estilo e, quando houver dúvida, com rótulo.
- Elimine elementos que não acrescentam informação: bordas duplas, caixas dentro de caixas, ornamentos.
- Prefira gráficos diretos: a forma mais simples que responde à pergunta.
- Dados variam: teste com nomes longos e valores vazios para que a forma continue limpa. A skill `break-ui` serve para isso.

**No ObraMate:** um card de Job deve ser lido de uma vez como um bloco com uma estrutura repetida, de modo que o olho aprenda onde estão cliente, horário e ação e não precise ler cada card do zero.

**Limite:** simplificar não é tirar informação necessária. Um ícone sem rótulo é mais simples visualmente, mas fica mais difícil de entender. Se a pessoa precisa adivinhar, a simplificação falhou.

---

## 12. Lei da Semelhança

**O que diz:** elementos parecidos em cor, forma, tamanho ou estilo são percebidos como iguais ou relacionados, mesmo quando separados. É outro princípio da Gestalt.

**Por que importa:** a aparência é uma promessa de comportamento. Se dois elementos iguais agem de formas diferentes, a pessoa deixa de confiar no que vê.

**Regras:**

- O mesmo tipo de elemento tem sempre a mesma aparência e o mesmo comportamento em todas as telas.
- Reutilize componentes e tokens existentes antes de criar novos. Verifique o CSS compartilhado primeiro.
- O mesmo status tem a mesma cor, o mesmo rótulo e o mesmo ícone em todas as superfícies.
- Links e botões são claramente interativos. Texto comum não pode parecer um link, e títulos em destaque não podem parecer botões.
- O vocabulário também é semelhança: uma coisa tem **um único nome**. Use o dicionário de `src/lib/i18n/dictionary.json` e não misture idiomas na mesma tela.
- Elementos diferentes precisam parecer diferentes. Ação destrutiva não usa o mesmo estilo da ação primária.

**No ObraMate:** um problema já identificado é a mistura de português e inglês e de termos entre módulos. Antes de criar um rótulo, procure como esse conceito já é chamado. Ao tocar em algo inconsistente, alinhe ao termo dominante.

**Limite:** consistência serve a quem usa, não é um fim em si. Quando uma superfície de campo e uma de escritório realmente têm necessidades distintas, os componentes podem diferir. O que deve permanecer igual é o significado.

---

## 13. Conectividade Uniforme

**O que diz:** elementos visualmente conectados por linhas, cor de fundo ou um contêiner são percebidos como mais relacionados do que elementos apenas próximos ou parecidos. Palmer e Rock descreveram esse princípio em 1994.

**Por que importa:** é o sinal de agrupamento mais forte que temos. Por isso, resolve ambiguidade quando o espaço não é suficiente, e também pode criar uma relação falsa se usado sem cuidado.

**Regras:**

- Use cards ou fundo comum para agrupar o que pertence a uma única entidade.
- Use linhas conectoras para indicar sequência, como etapas e a linha do tempo de um Job.
- Em celular, onde o espaço é limitado, prefira o contêiner à separação por espaço.
- A área inteira do contêiner deve se comportar como uma unidade: estados de hover e foco cobrem o bloco todo.
- Não coloque elementos sem relação na mesma caixa, pois isso cria uma relação falsa.
- Não aninhe card dentro de card sem necessidade. Prefira um único nível, separado por espaço ou divisórias.

**No ObraMate:** o bloco de dia na agenda conecta visualmente data e trabalhos daquele dia, e as etapas de lead a orçamento e a Job podem usar uma linha contínua para mostrar que são a mesma jornada.

**Limite:** conexão é uma ferramenta forte, e excesso de caixas gera ruído visual. Comece pelo espaço (lei 4) e adicione contêineres somente quando a separação continuar ambígua.

---

## 14. Lei de Tesler

**O que diz:** todo sistema tem uma quantidade de complexidade que não pode ser eliminada, apenas transferida. É a lei da conservação da complexidade, de Larry Tesler. A pergunta é sempre **quem vai arcar com ela**: o código ou a pessoa.

**Por que importa:** uma hora a mais de engenharia pode poupar milhares de decisões e erros de quem usa o sistema todos os dias.

**Regras:**

- Assuma a complexidade no sistema sempre que puder: cálculos, conversões, deduções e sincronizações são feitos pelo software.
- Nunca peça o que o sistema já sabe: não peça para digitar de novo dados de cliente, endereço ou tenant.
- Use padrões e sugestões em vez de campos em branco.
- Evite configurações como saída fácil. Cada preferência transfere uma decisão para a pessoa. Decida quando houver uma resposta claramente melhor.
- Quando a complexidade for real, como em regras fiscais ou de aprovação, explique a consequência no momento da escolha.
- Não esconda complexidade que a pessoa precisa controlar. Automação tem saída visível e pode ser revista ou corrigida.

**No ObraMate:** a regra de entrada de pedidos é um bom exemplo. Existe uma única escolha por empresa, entre revisar antes ou aceitar automaticamente, e o sistema cuida do resto, para os dois caminhos de acesso. O mesmo vale para a distinção entre data solicitada e data confirmada: a complexidade existe, e cabe à interface deixá-la clara.

**Limite:** simplificar demais pode tirar controle de quem precisa dele. E esconder complexidade sem resolvê-la só adia o problema. Se a automação errar sem que ninguém perceba, a complexidade voltou multiplicada.

---

## 15. Lei de Postel

**O que diz:** seja conservador no que envia e liberal no que aceita. É o princípio da robustez, escrito por Jon Postel na especificação do TCP nos anos 1980. Na UX, significa aceitar as muitas formas com que as pessoas se expressam e devolver sempre dados limpos.

**Por que importa:** quem usa o sistema pensa em conteúdo, não em formato. Rejeitar um telefone válido por causa de um parêntese é um erro do sistema, não da pessoa.

**Regras:**

- Aceite formatos variados e normalize: telefone com ou sem máscara, valores com `$` e vírgula, e-mail com espaços ou maiúsculas, datas em formatos comuns.
- Remova espaços nas pontas em todas as entradas de texto e aceite colagem de texto em qualquer campo.
- Formate a saída de maneira consistente: uma única forma de exibir telefone, data e dinheiro.
- Valide ao sair do campo ou ao enviar, não a cada tecla. Nunca mostre erro enquanto a pessoa ainda digita.
- A mensagem de erro indica o formato esperado com um exemplo, e o campo mantém o conteúdo digitado.
- Faça a interface tolerar dados incompletos ou legados: um campo vazio não pode quebrar a tela.
- Nas APIs, tolere campos extras desconhecidos e mantenha respostas previsíveis e estáveis.
- Considere variedade real: acentos, nomes muito longos ou curtos, endereços incomuns, conexão instável.

**No ObraMate:** `crm/public/crm-phone.js` e `normalizePhoneDigits` em `crm/public/lead-contact-links.js` já cuidam de telefone. Reutilize-os, sem criar novas lógicas de formatação. O mesmo se aplica à entrada de pedidos no portal, em que leitura assistida de anexos aceita documentos variados e entrega campos estruturados para revisão.

**Limite:** **tolerância não dispensa validação.** Toda entrada continua sendo validada e sanitizada no servidor, e os limites de tenant e de RLS nunca são flexibilizados. Quando houver ambiguidade real, como `03/04` poder ser março ou abril, peça confirmação em vez de adivinhar. Dinheiro, permissões e autenticação pedem rigor, não liberalidade.

---

## 16. Lei de Parkinson

**O que diz:** o trabalho se expande até ocupar todo o tempo disponível. C. Northcote Parkinson escreveu isso em 1955, sobre burocracia. Na UX, significa que uma tarefa sem limite ou sem caminho curto tende a consumir mais tempo e atenção do que precisa.

**Por que importa:** quem está em obra ou atendendo cliente não tem tempo sobrando. Cada campo opcional e cada etapa extra toma tempo do trabalho real.

**Regras:**

- Corte campos. Para cada um, pergunte: "isto é necessário agora?". Se não for, peça depois.
- Use `autocomplete`, pré-preenchimento, último valor usado e sugestões para encurtar a digitação.
- Faça as tarefas mais frequentes do dia exigirem o menor número possível de toques, e meça isso.
- Permita agir em lote quando o mesmo trabalho se repete.
- Quando ajudar, indique o tempo real: "Leva cerca de 2 minutos". Só faça isso se a estimativa for verdadeira.
- Defina prazos reais e visíveis quando houver, como validade de orçamento e data de vencimento.
- Salve automaticamente, em vez de exigir etapas de salvamento.

**No ObraMate:** registrar a jornada em `campo/horas` deve levar segundos. Um orçamento recorrente deve partir do último parecido. Se uma tarefa diária de 3 toques passa a pedir 6, isso é uma regressão, mesmo que a tela tenha ficado mais bonita.

**Limite:** não use prazos falsos ou contagem regressiva para forçar decisões, e não pressione onde o cuidado importa mais que a velocidade, como em valores, contratos ou ações de segurança. Nesses casos, um passo a mais é correto.

---

## 17. Navalha de Occam

**O que diz:** entre explicações equivalentes, prefira a que faz menos suposições. Vem de Guilherme de Ockham, filósofo do século XIV. Na prática: **se duas soluções resolvem igualmente o problema, escolha a mais simples**.

**Por que importa:** cada elemento, opção ou tela precisa ser aprendido, testado, mantido e traduzido para sempre. O que não é necessário cobra esse custo sem dar retorno.

**Regras:**

- Antes de adicionar algo, pergunte: "o que acontece se isto não existir?". Se a resposta for "nada de relevante", não adicione.
- Antes de criar um componente, página ou endpoint, verifique se um existente resolve.
- Resolva o problema apresentado, sem generalizar para casos hipotéticos.
- Ao concluir uma tela, faça uma revisão de remoção: tire um elemento por vez enquanto ela continuar funcionando.
- Retire o que ficou obsoleto em vez de acumular camadas. Prefira um único caminho para cada tarefa.
- Prefira texto direto. Corte instruções que a própria interface deveria tornar desnecessárias.

**No ObraMate:** existem superfícies antigas e novas para as mesmas funções, como as rotas legadas de portal. Não crie uma terceira. Consolide no caminho atual, mantendo a compatibilidade até confirmar que o uso anterior terminou.

**Limite:** a navalha compara soluções **que resolvem igualmente o problema**. Uma solução mais simples, mas sem acessibilidade, sem tratamento de erro ou sem isolamento entre tenants, não é equivalente, é incompleta.

---

## 18. Princípio de Pareto

**O que diz:** em muitos sistemas, cerca de 80% dos efeitos vêm de cerca de 20% das causas. Vem de uma observação de Vilfredo Pareto sobre distribuição de riqueza, e foi Joseph Juran quem a popularizou. A proporção exata varia, o que importa é a **distribuição desigual**.

**Por que importa:** poucos fluxos respondem pela maior parte do uso e do valor. Dar a mesma atenção a todos faz os mais importantes ficarem medianos.

**Regras:**

- Identifique os fluxos críticos de cada superfície e faça com que sejam excelentes antes de polir os demais.
- Use dados de uso reais, quando houver, em vez de suposições.
- Priorize correções por frequência e impacto: um pequeno atrito em uma tarefa diária costuma importar mais que um bug visual em uma tela rara.
- Dê acesso de primeiro nível ao que é mais usado, e mantenha o restante a um ou dois passos.
- Teste primeiro o caminho principal, com rigor, e depois os casos de borda relevantes.
- Ao propor um trabalho grande, indique a menor parte que entrega a maior parte do valor.

**No ObraMate:** os fluxos centrais incluem lead até orçamento, orçamento até Job, agenda, trabalho do dia no Campo e fatura até pagamento. Em caso de dúvida sobre prioridade, comece por eles.

**Limite:** os 20% restantes não podem ser ignorados. **Acessibilidade, segurança, isolamento de tenants e integridade dos dados não entram nessa conta**: valem para todo caminho, por menos usado que seja. Uma regra usada raramente também pode ser a mais crítica, como um fechamento financeiro.

---

## Quando as leis entram em conflito

Isso vai acontecer. A prioridade é esta, de cima para baixo:

1. **Segurança, integridade dos dados e isolamento de tenants**
2. **Acessibilidade**
3. **Conclusão da tarefa principal**, sem erro e sem perda de trabalho
4. **Consistência** com o que já existe no ObraMate
5. **Velocidade e eficiência**
6. **Refinamento visual**

Conflitos frequentes:

| Conflito | Como decidir |
|---|---|
| Hick (menos opções) × Pareto (acesso rápido) | Mantenha à vista só o mais usado e deixe o restante a um passo, sem removê-lo. |
| Tesler (o sistema absorve) × Occam (simplicidade) | Prefira um código mais complexo se ele poupar trabalho repetido da pessoa. A navalha nunca transfere o trabalho para ela. |
| Von Restorff (destaque) × Semelhança (uniformidade) | A uniformidade é a base, e o destaque é a exceção rara que só funciona por causa dela. |
| Postel (aceitar tudo) × validação rigorosa | Seja tolerante no formato e rigoroso no significado e na segurança. |
| Doherty (velocidade) × pico-fim (confirmação) | Resposta instantânea na rotina. Para o que for irreversível, um passo a mais é correto. |
| Jakob (convenção) × necessidade do campo | Mantenha a convenção. Rompa-a só quando o contexto de uso exigir, como aumentar alvos em obra. |

## Checklist antes de entregar

Passe por esta lista em toda mudança que afete o que alguém vê ou faz. Marque como não aplicável o que não couber.

**Decisão e foco**
- [ ] Identifiquei a superfície e quem usa (CRM, Campo, Portal, Admin).
- [ ] Há uma ação primária evidente e opções secundárias com menos destaque. *(1, 7)*
- [ ] Nada que eu adicionei poderia ser removido sem prejuízo. *(17)*
- [ ] Priorizei os fluxos mais usados e não piorei a tarefa frequente. *(16, 18)*

**Alcance e leitura**
- [ ] Alvos de toque têm 44 px ou mais (48 px no campo), com folga entre si. *(2)*
- [ ] Controles e padrões seguem as convenções da plataforma e do próprio produto. *(3)*
- [ ] Espaço, contêineres e semelhança deixam os grupos evidentes. *(4, 11, 12, 13)*
- [ ] O importante está no início ou no fim, não enterrado no meio. *(8)*
- [ ] Reutilizei componentes, tokens e termos existentes. *(12)*

**Memória e resposta**
- [ ] A pessoa não precisa lembrar de dados de outra tela. *(5)*
- [ ] Há estados de carregamento, sucesso, vazio e erro. *(6, 9)*
- [ ] Toda ação responde na hora, e ações lentas mostram o que está acontecendo. *(6)*
- [ ] Toque duplicado não cria duplicidade. *(6)*

**Erros e finais**
- [ ] A mensagem de erro é humana, explica como resolver e mantém o que foi digitado. *(9, 15)*
- [ ] O fluxo termina com confirmação e próximo passo. *(9)*
- [ ] Trabalho interrompido pode ser retomado, e pendências ficam visíveis. *(10)*
- [ ] Entradas aceitam formatos comuns e são validadas no servidor. *(15)*
- [ ] O sistema não pede o que já sabe. *(14)*

**Base**
- [ ] Significado não depende só de cor, há foco visível, rótulos e contraste suficientes.
- [ ] Testei no tamanho de tela real da superfície e com dados extremos.
- [ ] Sem padrões enganosos, como urgência falsa ou recusa escondida. *(7, 10, 16)*
- [ ] Nenhum concorrente ou produto de referência citado em arquivos, commits ou PRs.

## Como isto é aplicado

1. **Antes de implementar:** identifique a superfície e as leis mais relevantes para a mudança. Não é preciso discutir as 18 toda vez, a maioria passa em silêncio quando se segue o padrão.
2. **Durante:** siga as regras e, quando for mudança de UI, abra e use a tela de verdade sempre que o ambiente permitir.
3. **Na entrega:** rode o checklist. Relate apenas o que importa: exceções deliberadas, com a lei e o motivo, e o que não foi possível verificar.
4. **Ao encontrar uma violação fora do escopo:** não corrija junto. Registre e proponha separadamente.
5. **Ao discordar de um pedido por causa de uma lei:** explique o conflito e proponha uma alternativa. A decisão final é do dono do produto, e este documento informa essa decisão, sem vetá-la.

Este documento deve evoluir. Quando uma regra se mostrar errada para o ObraMate, ajuste-a aqui, com o motivo, em vez de ignorá-la em silêncio.
