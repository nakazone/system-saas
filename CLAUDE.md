# Instruções do projeto

## Padrão de UX (obrigatório)

Todo desenvolvimento neste repositório segue as 18 leis de UX de [`docs/ux-laws.md`](docs/ux-laws.md). Isso vale para telas, componentes, fluxos, textos, erros e notificações, e também para APIs e validações que afetam o que a pessoa vê.

**Antes de criar ou alterar algo visível para quem usa o sistema, leia `docs/ux-laws.md`.** Antes de entregar, passe pelo checklist desse documento e relate exceções deliberadas (lei e motivo) e o que não foi possível verificar.

Identifique a superfície primeiro: CRM (escritório, muitos dados), Campo/ObraCam/Obra Crew (celular, uma mão, conexão ruim), Portal ObraBuilder (uso esporádico, várias empresas) ou Admin (alto impacto).

Resumo das regras:

1. **Hick:** uma ação primária por tela, até 5 destinos na navegação móvel, busca em listas longas, padrões já selecionados.
2. **Fitts:** alvos de toque com 44 px ou mais (48 px no campo), ação perto do que afeta, destrutivo longe do frequente.
3. **Jakob:** convenções da plataforma e do próprio produto, controles nativos e tipos de input corretos.
4. **Proximidade:** espaço dentro do grupo menor que entre grupos; rótulo, ajuda e erro junto do campo.
5. **Miller:** agrupe dados e mantenha o contexto visível; a pessoa não memoriza nada entre telas.
6. **Doherty:** retorno imediato ao toque, meta de 400 ms, progresso em operações lentas, nada de envio duplicado. Sempre há estados de carregamento, sucesso, vazio e erro.
7. **Von Restorff:** um destaque forte por área, só no que exige atenção; nunca use só cor para dar significado.
8. **Posição serial:** o importante no início e no fim; informação essencial primeiro nos textos.
9. **Pico-fim:** cuide dos momentos críticos; todo fluxo termina com confirmação e próximo passo; erros são humanos e nunca perdem o que foi digitado.
10. **Zeigarnik:** rascunhos, progresso real e pendências visíveis; sem urgência falsa.
11. **Prägnanz:** grade, poucas variações, formas simples; sem elementos que não informam.
12. **Semelhança:** mesma aparência, comportamento e nome para a mesma coisa; reutilize componentes, tokens e o dicionário de i18n.
13. **Conectividade uniforme:** use contêineres e linhas para o que é realmente relacionado; sem caixas aninhadas à toa.
14. **Tesler:** o sistema absorve a complexidade; nunca peça o que ele já sabe; evite configuração como saída fácil.
15. **Postel:** aceite formatos variados e normalize, com saída consistente; sempre valide no servidor; nunca flexibilize segurança ou tenant.
16. **Parkinson:** corte campos, pré-preencha, reduza toques em tarefas diárias; sem prazos falsos.
17. **Occam:** entre soluções equivalentes, a mais simples; reutilize antes de criar; não crie caminhos paralelos.
18. **Pareto:** priorize os fluxos centrais; acessibilidade, segurança e integridade de dados valem para todos os caminhos.

Em caso de conflito, a prioridade é: segurança e dados, acessibilidade, conclusão da tarefa, consistência, velocidade e, por fim, refinamento visual.

## Regra de referências externas

Nunca cite concorrentes, inspirações ou produtos de referência em arquivos, commits, PRs ou nomes de branch. Descreva recursos em termos do ObraMate. Bibliotecas e APIs de terceiros realmente usadas são exceção. A regra completa está em [`.cursor/rules/no-competitor-references.mdc`](.cursor/rules/no-competitor-references.mdc).
