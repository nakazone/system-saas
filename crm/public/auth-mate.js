/**
 * The Mate (fox mascot) on login, forgot and reset password.
 * Adds the graphite stage with the Mate waving and a speech bubble that reacts to the page:
 * greeting by time of day, a sorry face when sign-in fails, a cheer when it works.
 *   <body class="auth-mate" data-auth-page="login|forgot|reset">
 *   window.AuthMate.say(title, text, { mood: 'sorry' | 'happy' })
 */
(function () {
  if (window.AuthMate) return;
  var V = '20261027-m2';
  var M = '/assets/img/mascot/';
  var page = (document.body && document.body.getAttribute('data-auth-page')) || 'login';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function hello() {
    var h = new Date().getHours();
    return h < 12 ? 'Bom dia!' : h < 18 ? 'Boa tarde!' : 'Boa noite!';
  }

  var FIRST = {
    login: { title: hello(), text: 'Entra aí que eu já separei o seu dia.' },
    forgot: { title: 'Acontece!', text: 'Me passa o seu e-mail que eu mando um link para criar uma senha nova.' },
    reset: { title: 'Quase lá.', text: 'Escolhe uma senha nova e a gente volta ao trabalho.' },
  };

  var root = document.querySelector('.login-container');
  if (!root) return;

  var stage = document.createElement('aside');
  stage.className = 'auth-stage';
  stage.setAttribute('aria-label', 'Mate');
  stage.innerHTML =
    '<a class="auth-stage__brand" href="https://obramate.com" target="_blank" rel="noopener"><img src="/assets/obramateLogoSmallTransp.png" alt="" height="26"><span>ObraMate</span></a>' +
    '<div class="auth-stage__scene">' +
    '<img class="auth-stage__mate" src="' + M + 'mate-wave.webp?v=' + V + '" alt="Mate, o assistente do ObraMate" decoding="async">' +
    '<div class="auth-bubble" role="status" aria-live="polite"></div>' +
    '</div>' +
    '<div class="auth-stage__copy">' +
    '<h2>Seu escritório inteiro, a um pedido de distância.</h2>' +
    '<p>Peça ao Mate por texto ou voz: quotes, agenda, faturas, folha. Ele prepara, você confirma.</p>' +
    '</div>';
  root.insertBefore(stage, root.firstChild);

  var bubble = stage.querySelector('.auth-bubble');
  var mate = stage.querySelector('.auth-stage__mate');

  function say(title, text, opts) {
    opts = opts || {};
    bubble.classList.remove('is-on');
    bubble.classList.toggle('is-sorry', opts.mood === 'sorry');
    setTimeout(function () {
      var face = opts.mood ? '<img src="' + M + 'mate-head-' + (opts.mood === 'sorry' ? 'sorry' : 'happy') + '.webp?v=' + V + '" alt="" width="30" height="30">' : '';
      bubble.innerHTML = '<span class="auth-bubble__t">' + face + '<b>' + esc(title) + '</b></span>' + esc(text || '');
      bubble.classList.add('is-on');
    }, 140);
    if (opts.hop) hop();
  }

  function hop() {
    mate.classList.remove('is-hop');
    void mate.offsetWidth;
    mate.classList.add('is-hop');
  }

  mate.addEventListener('click', function () {
    hop();
  });

  var first = FIRST[page] || FIRST.login;
  setTimeout(function () {
    say(first.title, first.text);
  }, 650);

  // React to the page's own error and success messages (no change to the forms' code).
  function watch(id, onShow) {
    var el = document.getElementById(id);
    if (!el || !window.MutationObserver) return;
    var last = '';
    new MutationObserver(function () {
      var visible = el.style.display !== 'none' && !el.hidden && el.textContent.trim();
      var now = visible ? el.textContent.trim() : '';
      if (now && now !== last) onShow(now);
      last = now;
    }).observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
  }

  watch('errorMessage', function () {
    say('Opa, não bateu.', 'Confere o e-mail e a senha. Se esqueceu, eu te ajudo a criar outra.', { mood: 'sorry' });
  });
  watch('fpError', function () {
    say('Opa.', 'Não consegui enviar agora. Confere o e-mail e tenta de novo.', { mood: 'sorry' });
  });
  watch('rpError', function () {
    say('Opa.', 'Essa senha não deu. Confere as regras e tenta de novo.', { mood: 'sorry' });
  });
  ['fpDone', 'rpDone'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el || !window.MutationObserver) return;
    new MutationObserver(function () {
      if (!el.hidden) say(id === 'fpDone' ? 'Mandei!' : 'Prontinho!', id === 'fpDone' ? 'Olha o seu e-mail (e o spam, por via das dúvidas).' : 'Senha nova salva. Bora entrar.', { mood: 'happy', hop: true });
    }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
  });

  // Company picker after sign-in: the Mate asks which one.
  var picker = document.getElementById('workspacePicker');
  if (picker && window.MutationObserver) {
    new MutationObserver(function () {
      if (picker.style.display === 'block') say('Você está em mais de uma empresa.', 'Qual vamos abrir hoje?', { hop: true });
    }).observe(picker, { attributes: true, attributeFilter: ['style'] });
  }

  window.AuthMate = { say: say, hop: hop };
})();
