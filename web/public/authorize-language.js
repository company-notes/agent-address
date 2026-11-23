/* Auth pages use the same language catalog and preference as the Portal. */
(function () {
  'use strict';

  var language = window.NuwaLanguage;
  var selector = document.getElementById('language');
  if (!language || !selector) throw new Error('The Agent Address language selector is unavailable.');

  function render() {
    selector.value = language.current();
    language.translateDocument();
  }

  selector.addEventListener('change', function () {
    language.change(selector.value);
  });

  language.subscribe(render);
  render();
})();
