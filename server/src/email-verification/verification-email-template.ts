// Approved PWA marks rendered as small PNGs for email clients (which may not support SVG).
const ACCOUNT_LOGO_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABABAMAAABYR2ztAAAAMFBMVEXPt0M6MxcQERMNDxALDA4KCwwJCgwICQoICAcHCAkGBwgGBwUFBggEBAUDBAcBAQQYbjTpAAAEtElEQVR42nWVXWxURRiGn292lwJCO2fRVkDa4cciENpVDEiMUCVeaPhLxAtiNEjQxAuxiTH1QiIBbwxasCRqRIlAYkgUCUpCJIBUjBdGYNsEQ8zSnm6hgFQ6W4RS2u54cWZ3C4l7cZLNvOc5833v+82I49Q6/E80AEH0EC3vGsTdnnfPumhAtGgk9o5RFNcBnAUN/sHEZuIDlAB9Eiyjo080gmhEMz5Uf4x6e9a+/LffhbtanAeAScuMEqHhRCeABMc+zUUAZS6q0vrSA51IEGh3fcGdCg/gIVVa/94GtacvXOhYH7h9fzlEo4DiJ8wZmzy8yQKT9i87Kz1vBZoZ4AqC+N+2ckXat2JubHss24IyEBQ+MdVWrjjpyw96/nl6ZHGIAcEL1Fm14qRGAAR1a77ublaALgim5Z45qUtNTF5ud4sBKWxS9car5S4XBvoP9fxAgCc8lVsl3OVC1dtuUShALADUmWEAGQvIWNGIltZcz4eDeEK5NdwNgMWtw4aCoF6WRDuiaKNSuysWhV6gDibakL67AIaRhmsNBQHlFuVqRgNg6p6BOi+YmlupGWk8BWisByBHXDugEG0QQA9ahPgrBRuTl/WaEKUgdzaRhuCb/oNoxm3LewBOC6BEx8JKEG67VgGd3dZJ5MKU9NV1ysRhDHdAEw/ra5GBxuTQ8y9ENctgOSjNHTst+n/FiR6+XjHmx8h3yYFxCiawAw3yxp2DIDez+ZlfpQVwYwCrQIsRgEsVj4NMennzxTkfWUD95uIOBTWEGqDMXAmB2nrdNXe5BYQWy6jYT2zt3y2a+JEuutZOAEKdRpUEWm1xBjALNmranwMgxJTmAskwz2J2hgsv4pLO21QUaMiba4YnhcRL4D4AWO3zYCIbq9IDm1wN5r69ED+gjLEOlA+KBiTnnkikKuRoDTKYBk2jQSFdTnwOmun+1R6d0GKp26SMmyN5UOhbrIuCJKHu323dT/XU7E+BHc8IKCGhsz5IVZvdA9K1M1TnTynjRhwxUJo8t30l5a9SM7FppQxt1WBxZRYUjE1Zn8TEYfpoOln3XkoZR1lDVTsocHtuvO+jfFSj36zZ/yhgIfRzIZ9gfJTLNUty5/ehjIPJ9oSJGpVxz9qoX7PTfHF8awqwmMlS7Ql5fclFUY5lxf2eQhmH6t4+PhsJ9Ni2GzuihqvTvrEW07bj/mj0BGlxa6JZCMqndxMBhtbnMgZQaOSqPucdG97V6gFHlpZFVQiix7XdaIxmQTI6AuTXpquyAEoD8nHFouro64EHHP5cMv58EI2MO9T9YuhHXxmH6tiwufqX6ACNeni8ovLm1sBbYhmaPU0y2UgfuTDUln9koy0AKGu3HlDIpNmtuxat7rAA9vSsx1Yloh2A8i48eE53pZrqOjoyx2JNeytk0AP8Hgzqs2x1T3Ll18C/yT5p/tkUxuF10SgD+tKGaotonEWalxfHIV6IvUz9svfhTtcHkuzNFNeVCrQ/UGRK8xm3ZXpyfr73WLZ0Ucqfe5hRuFPz2dc0+ROULjpUfKZNFs/PeMOxC7GUMqNuWhNPRDYWil4wY/RFjEJJYxGgjBt1XhTqpzZVBGAx9wBQqIX/C1AG/gPzv4+jdsEPVgAAAABJRU5ErkJggg==';
const PLATFORM_LOGO_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABABAMAAABYR2ztAAAAMFBMVEXEqzZSTDEjIh0PERINDg8LDA4KCw0JCgsHCQoICAcHBwcGBwkFBgcEBAUDAwYAAAPCkv4rAAAFEUlEQVR42n2Wa2wUVRTHf+fuFKGm3TuLqEjLzq6IkNDu1miqCa8EKYkEixE1flCJzxgfEIlfNAIxamIi+CBGPggJ8W0EpSYmxgetGjExa7tF8UXpdtvaipG50/JqsXP9MLMtfNBJ9svc//7uOed/7rkjlhNz+Y9HGtoRG84Td/KVC6Kjnyvh570/eIpvVGbqP77vW99gDRgrL6xfijNxU5OZEqQyhCULGjR8Otfpck6lptavWP9EDxc9e3a3AgHRZ7qWSpOqLKvWXb0Akt35vuAiGtIPq0BXQl7zQi/iutr2tIxZiV4OJyVVCTG3z6QWbiUxcfBFX9Zc6ooGqt6UmV607n1hLn/19ZKGi+7f1Kn+2OJqIHG4IkgcK81f2umCiw2uS2xxPi4CyIJEdRRD/XezWoouyHTU7NGzlx0+VD8dkHlxDuqAerSoiQsgpxu8HzcAkiUW1AUr9mui7EFSZ74Omw2IJopB/V7VKLEXLrjIiYG2wT2S1dMiwqKgNWAKAMy5N1xlREOiWoP66WRyRgwwLi6ipRT89GT1dBIKICzlJgFtREWc0TaR1xAF2Sg5TZRCQ11aRy3xenJlKRaoA1XFGMCvxzfEpa/JH0ljUYCYNDFAB+nrjWiAcM/pHAYF1AV3VmpwqrlrqNIfv9iyjbbISSkG1D7wcXf/Fh11xaC+pxRV8sNpxRiQ2D68rTZyTzSeUaAgYSop6OH2n2d71xlAMsz56K9GUFBlanQEsJtG/JqOkiFu/rEcKDhrkjHANtbfrV4b2Q6SAcSCVlDD1tiCv7yFefk5WY4ADAEodFIqB6Eu+ED0gvZVJckAwaAdBSVM9kH4XO3TBpsZzosGq4SPSpEXEgFOLJv73VOo3eN3ZQDjGV0GBelKE5wudXff0MnRdIsGq4AuUEgFYHeM7mzqfrs0u6vcDsYD8FBRNghQW9exOTltuyr33xEBWAsKKkYc897LfzI0sTC3t9bDeKBNbBZ5BGgOGpj5TNA33OM1dyogTSs4QmCLaKh96PlNHjWb83efGp+LB2G91IKynOElARnKpTVwyYfJK6eNPAIwAwQloPsB7fQd1EDi3XL52uQgYK2gUYAeBQlfUa8AyNXbgu7SinYQe8EIKNzqvAEd9NYd6PV9/3jhgs1pd7AVBtZe3AEO2Jczd7UxttyfnFUvuUF9gHSlPXBA9tj8V3bdntQ5I9Te1+pdZgqAAxxJtizWRe2fM2LRXrhA6vvBAfekHkUc/7wp3GMGvp1RFnAQqjsym3dwWzyCARezDtl6RTEPjmjkjfDWJVwFktXgZwEIVwTf98dnU4a8Q8n4LMQ2wo83Th8hFugLO0bXm7iVoz4gXN0+vy8WCLIr2bzsfMDAO6qgY4FGxvf3X2POA7RsrC9G8w8BkoXkJRuCKUA4a5Hqic6wQiNajhUnVm0oVQBh1Velhv3RXk40kfRer3vlF/skBYRdK2c2OYW+eMTG1Rk7qLuX3ZL7u1AoDNzXVqvGi3FJnUr13zrUcHjeI1uBk9le2dU5eY3MekwAxDu5ssHggjXI7tWj8QYjKlweCVNzPjuSwfd9I/PC1f0V0zaqZJRNBjVn3w92Rza7OPzt+/7KBvRJU7PWoJrAjkwE61zCQrlp0nV1vYw03K6nbDzquyqjp9pi1hL55+I/t8WA+PaSKYG6+SmVOFD/+DmXd3RM4yc7c3ytw6Kx+Q82AaTOk5Hl6IreLxHLiUbzP58H/wLrKcRSrH9eggAAAABJRU5ErkJggg==';

export type EmailVerificationKind = 'PLATFORM' | 'ACCOUNT';

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] || char);
}

/** One responsive HTML-email template; branding is selected by the destination account kind. */
export function verificationEmail(kind: EmailVerificationKind, address: string, url: string) {
  const isAccount = kind === 'ACCOUNT';
  const brand = isAccount ? 'Запись' : 'Кабинет';
  const logo = isAccount ? ACCOUNT_LOGO_PNG : PLATFORM_LOGO_PNG;
  const logoCid = 'verification-brand@va-tools.ru';
  const safeAddress = escapeHtml(address);
  const safeUrl = escapeHtml(url);
  const font = 'font-family:Arial,Helvetica,sans-serif;';
  const html = [
    '<!doctype html><html lang="ru"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Подтвердите email</title></head>',
    '<body style="margin:0;padding:0;background:#24272b;">',
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background:#24272b;border-collapse:collapse;">',
    '<tr><td align="center" style="padding:20px 12px 34px;">',
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:640px;border-collapse:separate;">',
    '<tr><td style="padding:0 6px 22px;text-align:left;">',
    '<img src="cid:', logoCid, '" alt="', brand, '" width="72" height="72" style="width:72px;height:72px;display:block;border:0;border-radius:13px;">',
    '</td></tr><tr><td style="background:#fafafa;border-radius:42px;padding:38px 35px 35px;">',
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:separate;border:1px solid #303236;border-radius:23px;background:#fff;box-shadow:0 13px 28px rgba(0,0,0,.22);">',
    '<tr><td style="padding:31px 30px 24px;', font, '">',
    '<h1 style="margin:0 0 13px;font-size:31px;line-height:1.15;font-weight:700;letter-spacing:-.5px;color:#101010;">Подтвердите email</h1>',
    '<p style="margin:0 0 23px;font-size:17px;line-height:1.45;color:#4c5054;">Подтвердите адрес электронной почты,<br>чтобы завершить настройку профиля.</p>',
    '<div style="border-top:1px solid #dedfe1;margin:0 0 20px;"></div>',
    '<p style="margin:0 0 18px;font-size:17px;line-height:1.4;font-weight:700;color:#161616;overflow-wrap:anywhere;word-break:break-word;">', safeAddress, '</p>',
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:separate;"><tr>',
    '<td align="center" bgcolor="#050505" style="border-radius:11px;background:#050505;">',
    '<a href="', safeUrl, '" style="display:block;padding:18px 10px;color:#fff;text-decoration:none;', font, 'font-size:19px;line-height:1.25;font-weight:700;text-align:center;">Подтвердить email</a>',
    '</td></tr></table>',
    '<p style="margin:18px 0 0;color:#656a70;font-size:15px;line-height:1.4;">Ссылка действует 24 часа.</p>',
    '</td></tr></table>',
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border-collapse:collapse;">',
    '<tr><td style="padding:35px 6px 0;', font, '">',
    '<p style="margin:0 0 18px;color:#52565b;font-size:17px;line-height:1.45;">Если вы не запрашивали подтверждение,<br>просто проигнорируйте письмо.</p>',
    '<div style="border-top:1px solid #dcdddf;margin:0 0 12px;"></div>',
    '<p style="margin:0;color:#666c72;font-size:14px;line-height:1.45;">Письмо отправлено автоматически.<br>Ответы на этот адрес не обрабатываются.</p>',
    '</td></tr></table></td></tr></table></td></tr></table></body></html>',
  ].join('');
  const text = 'Подтвердите email ' + address + '\n\n' +
    'Подтвердить email: ' + url + '\n\n' +
    'Ссылка действует 24 часа.\n' +
    'Если вы не запрашивали подтверждение, просто проигнорируйте письмо.';
  return {
    subject: 'Подтвердите email — ' + brand,
    html,
    text,
    attachments: [{
      filename: 'brand.png',
      content: Buffer.from(logo, 'base64'),
      contentType: 'image/png',
      cid: logoCid,
      contentDisposition: 'inline' as const,
    }],
  };
}
