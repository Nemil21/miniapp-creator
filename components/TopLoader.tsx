'use client';

import NextTopLoader from 'nextjs-toploader';

export function TopLoader() {
  return (
    <NextTopLoader
      color="#000000"
      crawlSpeed={200}
      height={3}
      crawl={true}
      showSpinner={false}
    />
  );
}

