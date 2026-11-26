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

  var type = document.getElementById('su-org-type');
  var fields = [document.getElementById('su-org-name'), document.getElementById('su-org-slug')];
  var previousType = type.value;

  type.addEventListener('change', function () {
    fields.forEach(function (field) {
      if (!field.value.trim() || field.value === field.dataset[previousType]) {
        field.value = field.dataset[type.value];
      }
    });
    previousType = type.value;
  });

  language.subscribe(render);
  render();
})();
