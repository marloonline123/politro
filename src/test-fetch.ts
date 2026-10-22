async function test() {
  const url = 'https://www.instagram.com/contact.clickacareer/';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
      },
    });

    console.log('HTTP Status:', res.status);
    console.log('Final URL:', res.url);
    const html = await res.text();
    console.log('HTML length:', html.length);

    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const ogTitleMatch = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i);
    const ogDescMatch = html.match(/<meta\s+(?:property|name)=["']og:description["']\s+content=["']([^"']+)["']/i);
    const metaDescMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);

    console.log('Title:', titleMatch ? titleMatch[1] : 'null');
    console.log('og:title:', ogTitleMatch ? ogTitleMatch[1] : 'null');
    console.log('og:description:', ogDescMatch ? ogDescMatch[1] : 'null');
    console.log('description:', metaDescMatch ? metaDescMatch[1] : 'null');
  } catch (e: any) {
    console.error('Fetch error:', e.message);
  }
}

test();
