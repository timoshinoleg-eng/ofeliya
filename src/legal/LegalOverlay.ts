import { RELEASE_INFO, missingReleaseLegalFields } from './ReleaseInfo';

const ID = 'ofeliya-legal-overlay';

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[ch] ?? ch);
}

function row(label: string, value: string): string {
  return `<div class="legal-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '—')}</strong></div>`;
}

export function showLegalOverlay(): void {
  document.getElementById(ID)?.remove();
  const info = RELEASE_INFO;
  const missing = missingReleaseLegalFields(info);
  const root = document.createElement('div');
  root.id = ID;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Информация о приложении');

  const supportEmail = escapeHtml(info.supportEmail);
  root.innerHTML = `
    <style>
      #${ID}{position:fixed;inset:0;z-index:100000;background:rgba(5,3,8,.88);display:flex;align-items:stretch;justify-content:center;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);box-sizing:border-box;font-family:'Chakra Petch',Arial,sans-serif;color:#fff4ec}
      #${ID} .legal-sheet{width:min(100%,520px);height:100%;overflow:auto;background:#140912;border-left:1px solid rgba(255,79,181,.28);border-right:1px solid rgba(255,79,181,.28);box-sizing:border-box;padding:18px 18px 34px;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}
      #${ID} .legal-head{position:sticky;top:-18px;z-index:2;background:linear-gradient(#140912 80%,rgba(20,9,18,0));padding:18px 0 14px;display:flex;align-items:center;justify-content:space-between;gap:16px}
      #${ID} h1{font-size:20px;margin:0;color:#ff78c8;letter-spacing:.5px}
      #${ID} h2{font-size:14px;margin:24px 0 9px;color:#ffe066;text-transform:uppercase;letter-spacing:.7px}
      #${ID} p,#${ID} li{font:400 12px/1.55 'Chakra Petch',Arial,sans-serif;color:#d9c0cc}
      #${ID} ul{padding-left:20px;margin:8px 0}
      #${ID} .legal-row{display:grid;grid-template-columns:minmax(105px,.8fr) 1.5fr;gap:10px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:11px}
      #${ID} .legal-row span{color:#9e788b} #${ID} .legal-row strong{font-weight:600;overflow-wrap:anywhere}
      #${ID} a{color:#8fe8ff;text-decoration:none} #${ID} a:focus,#${ID} button:focus{outline:2px solid #8fe8ff;outline-offset:2px}
      #${ID} .legal-close{min-width:76px;height:38px;border:1px solid #ff4fb5;border-radius:10px;background:#42112f;color:#fff4ec;font:700 12px 'Chakra Petch',Arial,sans-serif;cursor:pointer}
      #${ID} .legal-note{padding:10px 12px;border:1px solid rgba(255,213,106,.4);background:rgba(255,213,106,.06);border-radius:10px;color:#ffe9a6;font-size:11px;line-height:1.45}
      #${ID} .legal-muted{color:#896a79;font-size:10px;margin-top:20px}
    </style>
    <div class="legal-sheet">
      <div class="legal-head"><h1>OFELIYA · STRAIN ZERO</h1><button class="legal-close" type="button">ЗАКРЫТЬ</button></div>
      ${missing.length ? `<div class="legal-note">Pre-release: обязательные реквизиты публикации не заполнены (${escapeHtml(missing.join(', '))}). Production MAX build должен выполняться через <strong>npm run build:max</strong>.</div>` : ''}

      <h2>О приложении и разработчике</h2>
      ${row('Приложение', `${info.appName} · v${info.version}`)}
      ${row('Бренд', info.developerBrand)}
      ${row('Разработчик / оператор', info.legalName)}
      ${row('Регистрационные данные', info.registration)}
      ${row('Адрес', info.address)}
      ${row('Поддержка', info.supportEmail)}
      ${info.supportPhone ? row('Телефон', info.supportPhone) : ''}
      <p>По вопросам работы приложения, удаления локальных данных и претензиям: <a href="mailto:${supportEmail}">${supportEmail}</a>.</p>

      <h2>Политика конфиденциальности</h2>
      <p>Текущая версия игры не имеет собственного серверного профиля и не отправляет результаты забегов на сервер разработчика. Игровые рекорды, достижения, настройки звука и история критических мутаций сохраняются локально в хранилище Mini App на устройстве.</p>
      <p>MAX Bridge предоставляет приложению клиентский контекст. Имя пользователя может отображаться на стартовом экране; параметр запуска challenge используется только для показа социальной цели. Эти данные не считаются доверенной авторизацией. Подписанная строка <code>initData</code> предназначена для будущей серверной валидации и в текущем релизе не отправляется разработчику.</p>
      <p>Challenge payload содержит только показатели забега (время, уничтоженные иммунные клетки, заражённые клетки, стадия мутации и лучшее комбо) и не содержит идентификатор пользователя.</p>
      <p>Пользователь может удалить локальные данные очисткой данных Mini App/сайта на устройстве. Дополнительные обращения по данным направляются в поддержку по адресу, указанному выше.</p>

      <h2>Условия использования</h2>
      <ul>
        <li>Приложение является развлекательной игрой и предоставляется без гарантии конкретного игрового результата.</li>
        <li>В текущей версии нет покупок, денежных призов, конкурсов и пользовательского контента.</li>
        <li>Социальные вызовы являются неофициальным сравнением локальных результатов и не дают наград или иных преимуществ.</li>
        <li>Запрещается вмешиваться в работу приложения, распространять вредоносный код или использовать приложение с нарушением применимого законодательства и правил MAX.</li>
        <li>Разработчик может обновлять механику, визуальное оформление и технические параметры приложения.</li>
      </ul>

      <h2>Техническая поддержка</h2>
      <p>При обращении укажите устройство, платформу MAX (iOS/Android/Desktop/Web), примерное время ошибки и последовательность действий. Не присылайте пароль, токен бота или иные секреты.</p>
      <p><a href="mailto:${supportEmail}?subject=OFELIYA%20STRAIN%20ZERO%20support">Написать в поддержку</a></p>
      <div class="legal-muted">Редакция: 09.09.2026. Перед публичной публикацией юридические реквизиты должны соответствовать данным подтверждённого профиля разработчика MAX.</div>
    </div>`;

  const close = (): void => root.remove();
  root.querySelector<HTMLButtonElement>('.legal-close')?.addEventListener('click', close);
  root.addEventListener('click', (event) => { if (event.target === root) close(); });
  document.addEventListener('keydown', function onKey(event) {
    if (event.key !== 'Escape' || !root.isConnected) return;
    document.removeEventListener('keydown', onKey);
    close();
  });
  document.body.appendChild(root);
  root.querySelector<HTMLButtonElement>('.legal-close')?.focus();
}
