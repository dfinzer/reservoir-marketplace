import fetcher from 'utils/fetcher'
import { paths } from '@reservoir0x/reservoir-sdk'
import supportedChains, { ReservoirChain } from 'utils/chains'
import { isAddress as isViemAddress } from 'viem'

const HOST_URL = process.env.NEXT_PUBLIC_HOST_URL

export type SearchCollection = NonNullable<
  paths['/search/collections/v1']['get']['responses']['200']['schema']['collections']
>[0] & {
  chainName: string
  chainId: number
  lightChainIcon: string
  darkChainIcon: string
  volumeCurrencySymbol: string
  volumeCurrencyDecimals: number
  tokenCount: string
  chainRoutePrefix: string
}

type Collection = NonNullable<
  paths['/collections/v7']['get']['responses']['200']['schema']['collections']
>[0]

export const config = {
  runtime: 'edge',
}

const spamCollections: Record<number, string[]> = {
  1: ['0x31fe9d95dde43cf9893b76160f63521a9e3d26b0'],
}

const locallyFilterSpam = (results: any[]) => {
  return results.filter((result) => {
    if (
      result.data.collectionId &&
      result.data.chainId &&
      spamCollections[result.data.chainId]
    ) {
      return !spamCollections[result.data.chainId].includes(
        result.data.collectionId
      )
        ? true
        : false
    } else {
      return true
    }
  })
}

export default async function handler(req: Request) {
  console.log('Handler function invoked');
  console.log('Request object:', req);

  const { searchParams } = new URL(req.url)
  const query = searchParams.get('query')
  const searchChain = searchParams.get('searchChain')
  console.log(`Search parameters received - Query: ${query}, SearchChain: ${searchChain}`);
  let searchResults: any[] = []
  let fallbackResults: any[] = []

  if (!query) {
    console.log('No query provided, exiting handler');
    const response = { error: 'No query provided' };
    console.log('Response object:', response);
    return new Response(JSON.stringify(response), {
      status: 400,
      headers: {
        'content-type': 'application/json',
      },
    });
  }

  try {
    if (searchChain) {
      const chain = supportedChains.find(
        (chain) => chain.routePrefix === searchChain
      )

      if (chain) {
        console.log(`Searching single chain - Chain: ${chain.name}`);
        searchResults = await searchSingleChain(chain, query)
      } else {
        console.log(`Chain not found for searchChain: ${searchChain}`);
      }
    }

    if (!searchResults.length) {
      console.log('No results from single chain search, searching all chains');
      fallbackResults = await searchAllChains(query)
    }

    console.log(`Search results - SearchResults: ${JSON.stringify(searchResults)}, FallbackResults: ${JSON.stringify(fallbackResults)}`);
    const finalResponse = {
      results: searchResults,
      fallbackResults: fallbackResults,
    };
    console.log('Final response object:', finalResponse);
    return new Response(
      JSON.stringify(finalResponse),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'Cache-Control': 'maxage=0, s-maxage=3600 stale-while-revalidate',
        },
      }
    )
  } catch (error) {
    console.error('Error caught in handler function:', error);
    const errorResponse = {
      error: 'An error occurred during the search.',
      details: error instanceof Error ? error.message : 'An unknown error occurred',
      stack: error instanceof Error ? error.stack : 'No stack trace available',
    };
    console.error('Error response object:', errorResponse);
    return new Response(JSON.stringify(errorResponse), {
      status: 500,
      headers: {
        'content-type': 'application/json',
      },
    });
  }
}

async function searchSingleChain(chain: ReservoirChain, query: string) {
  const { collectionSetId, community, reservoirBaseUrl } = chain
  const headers = {
    headers: {
      'x-api-key': process.env.RESERVOIR_API_KEY || '',
    },
  }

  let queryParams: paths['/search/collections/v1']['get']['parameters']['query'] =
    {
      name: query as string,
      limit: 6,
    }

  const queryData = { ...queryParams }
  if (collectionSetId) {
    queryData.collectionsSetId = collectionSetId
  } else if (community) {
    queryData.community = community
  }
  const promise = fetcher(
    `${reservoirBaseUrl}/search/collections/v1`,
    queryData,
    headers
  )
  promise.catch((e: any) => console.warn('Failed to search', e))

  let isAddress = isViemAddress(query as string)
  let searchResults = []

  if (isAddress) {
    const response = await fetcher(
      `${reservoirBaseUrl}/collections/v7?contract=${query}&limit=6`,
      {},
      headers
    )
    if (response.data && Array.isArray(response.data.collections) && response.data.collections.length > 0) {
      const processedCollections = response.data.collections.map(
        (collection: Collection) => {
          const processedCollection: SearchCollection = {
            collectionId: collection.id,
            contract: collection.primaryContract,
            image: collection.image,
            name: collection.name,
            allTimeVolume: collection.volume?.allTime,
            floorAskPrice: collection.floorAsk?.price?.amount?.decimal,
            openseaVerificationStatus: collection.openseaVerificationStatus,
            chainName: chain.name.toLowerCase(),
            chainRoutePrefix: chain.routePrefix,
            chainId: chain.id,
            lightChainIcon: chain.lightIconUrl,
            darkChainIcon: chain.darkIconUrl,
            volumeCurrencySymbol: chain.nativeCurrency.symbol,
            volumeCurrencyDecimals: chain.nativeCurrency.decimals,
            tokenCount: collection.tokenCount || '0',
          }
          return {
            type: 'collection',
            data: processedCollection,
          }
        }
      )
      searchResults = processedCollections
    }
    // if ethereum chain
    else if (chain.id === 1) {
      let ensData = await fetch(
        `https://api.ensideas.com/ens/resolve/${query}`
      ).then((res) => res.json())
      searchResults = [
        {
          type: 'wallet',
          data: {
            ...ensData,
            address: query,
          },
        },
      ]
    }
  }
  // if ethereum chain
  else if (
    chain.id === 1 &&
    /[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)?/gi.test(
      query as string
    )
  ) {
    let ensData = await fetch(
      `https://api.ensideas.com/ens/resolve/${query}`
    ).then((res) => res.json())

    if (ensData.address) {
      searchResults = [
        {
          type: 'wallet',
          data: {
            ...ensData,
          },
        },
      ]
    }
  } else {
    const searchResponse = await promise
    if (searchResponse.data && Array.isArray(searchResponse.data.collections) && searchResponse.data.collections.length > 0) {
      const processedSearchResults = searchResponse.data.collections.map(
        (collection: SearchCollection) => ({
          type: 'collection',
          data: {
            ...collection,
            chainName: chain.name.toLowerCase(),
            chainRoutePrefix: chain.routePrefix,
            chainId: chain.id,
            lightChainIcon: chain.lightIconUrl,
            darkChainIcon: chain.darkIconUrl,
            volumeCurrencySymbol: chain.nativeCurrency.symbol,
            volumeCurrencyDecimals: chain.nativeCurrency.decimals,
            tokenCount: collection.tokenCount,
            allTimeUsdVolume: collection.allTimeVolume,
          },
        })
      )
      searchResults = processedSearchResults
    }
  }
  //filter own known spam collections
  searchResults = locallyFilterSpam(searchResults)
  return searchResults
}

async function searchAllChains(query: string) {
  let searchResults: any[] = []

  const promises: ReturnType<typeof fetcher>[] = []

  let queryParams: paths['/search/collections/v1']['get']['parameters']['query'] =
    {
      name: query as string,
      limit: 6,
    }

  supportedChains.forEach(async (chain) => {
    const { collectionSetId, community, reservoirBaseUrl } = chain
    const headers = {
      headers: {
        'x-api-key': process.env.RESERVOIR_API_KEY || '',
      },
    }

    const query = { ...queryParams }
    if (collectionSetId) {
      query.collectionsSetId = collectionSetId
    } else if (community) {
      query.community = community
    }

    const promise = fetcher(
      `${reservoirBaseUrl}/search/collections/v1`,
      query,
      headers
    )
    promise.catch((e: any) => console.warn('Failed to search', e))
    promises.push(promise)
  })

  let isAddress = isViemAddress(query as string)

  if (isAddress) {
    const promises = supportedChains.map(async (chain) => {
      const { reservoirBaseUrl } = chain
      const headers = {
        headers: {
          'x-api-key': process.env.RESERVOIR_API_KEY || '',
        },
      }
      const { data } = await fetcher(
        `${reservoirBaseUrl}/collections/v7?contract=${query}&limit=6`,
        {},
        headers
      )
      return data.collections.map((collection: Collection) => {
        const processedCollection: SearchCollection = {
          collectionId: collection.id,
          contract: collection.primaryContract,
          image: collection.image,
          name: collection.name,
          allTimeVolume: collection.volume?.allTime,
          floorAskPrice: collection.floorAsk?.price?.amount?.decimal,
          openseaVerificationStatus: collection.openseaVerificationStatus,
          chainName: chain.name.toLowerCase(),
          chainRoutePrefix: chain.routePrefix,
          chainId: chain.id,
          lightChainIcon: chain.lightIconUrl,
          darkChainIcon: chain.darkIconUrl,
          volumeCurrencySymbol: chain.nativeCurrency.symbol,
          volumeCurrencyDecimals: chain.nativeCurrency.decimals,
          tokenCount: collection.tokenCount || '0',
        }
        return {
          type: 'collection',
          data: processedCollection,
        }
      })
    })
    let results = await Promise.allSettled(promises).then((results) => {
      return results
        .filter(
          (result) => result.status === 'fulfilled' && result.value.length > 0
        )
        .flatMap((result) => (result as PromiseFulfilledResult<any>).value)
    })

    if (results.length > 0) {
      searchResults = results
    } else {
      let ensData = await fetch(
        `https://api.ensideas.com/ens/resolve/${query}`
      ).then((res) => res.json())
      searchResults = [
        {
          type: 'wallet',
          data: {
            ...ensData,
            address: query,
          },
        },
      ]
    }
  } else if (
    /[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)?/gi.test(
      query as string
    )
  ) {
    let ensData = await fetch(
      `https://api.ensideas.com/ens/resolve/${query}`
    ).then((res) => res.json())

    if (ensData.address) {
      searchResults = [
        {
          type: 'wallet',
          data: {
            ...ensData,
          },
        },
      ]
    }
  } else {
    // Get current usd prices for each chain
    const usdCoinPrices = await fetch(`${HOST_URL}/api/usdCoinConversion`).then(
      (res) => res.json()
    )

    const responses = await Promise.allSettled(promises)
    responses.forEach((response, index) => {
      if (response.status === 'rejected') {
        console.warn(`Search for chain ${supportedChains[index].name} rejected:`, response.reason);
        return
      }
      if (!response.value.data || !Array.isArray(response.value.data.collections)) {
        console.warn(`Search for chain ${supportedChains[index].name} did not return collections array`);
        return;
      }
      const chainSearchResults = response.value.data.collections.map(
        (collection: SearchCollection) => ({
          type: 'collection',
          data: {
            ...collection,
            chainName: supportedChains[index].name.toLowerCase(),
            chainRoutePrefix: supportedChains[index].routePrefix,
            chainId: supportedChains[index].id,
            lightChainIcon: supportedChains[index].lightIconUrl,
            darkChainIcon: supportedChains[index].darkIconUrl,
            volumeCurrencySymbol: supportedChains[index].nativeCurrency.symbol,
            volumeCurrencyDecimals:
              supportedChains[index].nativeCurrency.decimals,
            tokenCount: collection.tokenCount,
            allTimeUsdVolume:
              (collection.allTimeVolume &&
                collection.allTimeVolume *
                  usdCoinPrices?.prices?.[index]?.current_price) ||
              0,
          },
        })
      )
      searchResults = [...searchResults, ...chainSearchResults]
    })

    // Sort results by all time usd volume only if usdCoinPrices is not null
    if (usdCoinPrices) {
      searchResults = searchResults.sort(
        (a, b) => b.data.allTimeUsdVolume - a.data.allTimeUsdVolume
      )
    }

    //filter own known spam collections
    searchResults = locallyFilterSpam(searchResults)
  }

  return searchResults
}
