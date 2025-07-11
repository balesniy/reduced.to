import { component$, useSignal, useVisibleTask$, $ } from '@builder.io/qwik';
import { DocumentHead, globalAction$, zod$ } from '@builder.io/qwik-city';
import { LinkBlock } from '../../components/dashboard/links/link/link';
import {
  LINK_MODAL_ID,
  LinkModal,
} from '../../components/dashboard/links/link-modal/link-modal';
import { fetchWithPagination } from '../../lib/pagination-utils';
import { SortOrder } from '../../components/dashboard/table/table-server-pagination';
import { FilterInput } from '../../components/dashboard/table/default-filter';
import { useToaster } from '../../components/toaster/toaster';
import { NoData } from '../../components/dashboard/empty-data/no-data';
import { DELETE_MODAL_ID, GenericModal } from '../../components/dashboard/generic-modal/generic-modal';
import { useDeleteLink } from '../../components/dashboard/links/link/use-delete-link';
import { QR_CODE_DIALOG_ID, QrCodeDialog } from '../../components/temporary-links/qr-code-dialog/qr-code-dialog';
import { addUtmParams, sleep } from '@reduced.to/utils';
import { fetchTotalClicksData } from '../../components/dashboard/analytics/utils';
import { writeFile, utils as xlsxUtils, read as xlsxRead } from "xlsx";
import { isValidUrl, normalizeUrl } from '../../utils';
import { ACCESS_COOKIE_NAME } from '../../shared/auth.service';
import { z } from 'zod';

export default component$(() => {
  const toaster = useToaster();

  // Pagination params
  const sort = useSignal<Record<string, SortOrder>>({});
  const page = useSignal(1);
  const limit = useSignal(10);
  const total = useSignal(0);
  const filter = useSignal('');
  const refetch = useSignal(0);
  const qrLink = useSignal<string | null>(null);

  const isLoadingData = useSignal(true);

  const linksContainerRef = useSignal<HTMLElement>();
  const linksMap = useSignal(
    new Map<
      string,
      { id: string; key: string; url: string; createdAt: string; clicks: number; expirationTime?: string; utm?: Record<string, string> }
    >()
  );
  const linksArray = Array.from(linksMap.value.values());

  // Delete modal
  const idToDelete = useSignal('');
  const deleteLinkAction = useDeleteLink();

  useVisibleTask$(async ({ track }) => {
    track(() => filter.value);
    track(() => refetch.value);
    track(() => page.value);

    // Default sort order
    sort.value = {
      createdAt: SortOrder.DESC,
    };

    if (refetch.value) {
      page.value = 1;
    }

    isLoadingData.value = true;

    try {
      const data = await fetchWithPagination({
        url: `${process.env.CLIENTSIDE_API_DOMAIN}/api/v1/links`,
        page: page.value,
        limit: limit.value,
        sort: sort.value,
        filter: filter.value,
      });

      isLoadingData.value = false;

      if ((filter.value && page.value === 1) || refetch.value) {
        refetch.value = 0;
        linksMap.value.clear();
        data.data.forEach((link) => linksMap.value.set(link.key, link));
      } else {
        data.data.forEach((link) => {
          if (!linksMap.value.has(link.key)) {
            linksMap.value.set(link.key, link);
          }
        });
      }
      total.value = data.total;
    } catch (err) {
      toaster.add({
        title: 'Oops! Something went wrong',
        description: 'We could not load your links. Please try again later.',
        type: 'error',
      });
      isLoadingData.value = false;
    }
  });

  // Watch for scroll events and load more items if necessary
  useVisibleTask$(
    () => {
      const linksContainer = linksContainerRef.value;
      if (linksContainer) {
        const checkScroll = () => {
          const maxPages = Math.ceil(total.value / limit.value);
          if (!maxPages || page.value > maxPages - 1) {
            return;
          }

          if (linksContainer.scrollTop + linksContainer.clientHeight < linksContainer.scrollHeight - 120) {
            return;
          }

          page.value++;
        };

        const debouncedCheckScroll = debounce(checkScroll, 50); // 200ms debounce time
        linksContainer.addEventListener('scroll', debouncedCheckScroll);
      }
    },
    {
      strategy: 'document-ready',
    }
  );

  const onModalSubmit = $(() => {
    refetch.value++;
    filter.value = '';

    toaster.add({
      title: 'Link created',
      description: 'Link created successfully and ready to use!',
      type: 'info',
    });
  });

  const getStats = $(async () => {
    const data = await fetchTotalClicksData();
    const worksheet = xlsxUtils.json_to_sheet(data);
    const workbook = xlsxUtils.book_new();
    xlsxUtils.book_append_sheet(workbook, worksheet, 'Stats');
    writeFile(workbook, 'stats.xlsx', {compression: true});
  });

  const useCreateBulkLink = globalAction$(async ({ urls }, { fail, cookie }) => {
    const response: Response = await fetch(`${process.env.API_DOMAIN}/api/v1/shortener/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cookie.get(ACCESS_COOKIE_NAME)?.value}`,
      },
      body: JSON.stringify(urls.map((url: string) => ({ url }))),
    });

    const data: { keys: string[]; message?: string[] } = await response.json();

    if (response.status !== 201) {
      return fail(500, {
        message: data?.message || 'There was an error creating your link. Please try again.',
      });
    }

    return data.keys.map((key: string) => ({ key }));
  }, zod$(z.object({ urls: z.array(z.string()) })));

  const action = useCreateBulkLink();

  const createLink = async (urls: string[]) => {
    const { value } = await action.submit({ urls });
    console.log(value);
  }

  const handleFileUpload = (event: { target: any }) => {
    const file = event.target?.files[0];
    if (!file) return;

    isLoadingData.value = true;

    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result;
        const workbook = xlsxRead(arrayBuffer, { type: 'array', sheetRows: 100 });

        // Читаем первый лист
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];

        // Конвертируем в JSON
        const jsonData = xlsxUtils.sheet_to_json(worksheet, { header: 1 });
        const mappedData = jsonData.map((item) => Array.isArray(item) ? item[0] : item)
          .filter(isValidUrl).map(normalizeUrl)

        await createLink(mappedData)

        isLoadingData.value = false;
        refetch.value++;

        toaster.add({
          title: 'Links created',
          description: `${mappedData.length} links created successfully!`,
          type: 'info',
        });
      } catch (error) {
        toaster.add({
          title: 'Oops! Something went wrong',
          description: 'We could not load your links. Please try again later.',
          type: 'error',
        });
        isLoadingData.value = false;
      }
    };

    reader.readAsArrayBuffer(file);
  };

  return (
    <>
      <GenericModal
        onSubmitHandler={$(() => {
          refetch.value++;
        })}
        idToDelete={idToDelete.value}
        operationType="delete"
        id={DELETE_MODAL_ID}
        confirmation="DELETE"
        type="link"
        action={deleteLinkAction}
      />
      <LinkModal onSubmitHandler={onModalSubmit} />
      <QrCodeDialog link={{ key: qrLink.value! }} />
      <div className="flex">
        <FilterInput
          filter={filter}
          onInput={$((ev: InputEvent) => {
            filter.value = (ev.target as HTMLInputElement).value;
            page.value = 1; // Reset page number when filter changes
          })}
        />
        <div className="ml-auto pl-4">
          <button className="btn btn-natural" onClick$={getStats}>
            Get stats
          </button>
        </div>
        <div className="pl-4">
          <button className="btn btn-primary" onClick$={() => (document.getElementById(LINK_MODAL_ID) as any).showModal()}>
            Create a new link
          </button>
        </div>
        <div className="pl-4">
          <label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onchange={handleFileUpload}
              className="hidden"
            />
            <span className="btn btn-natural">
              Group link shortening
            </span>
          </label>
        </div>
      </div>
      <div ref={linksContainerRef} class="links overflow-y-auto h-screen p-5" style={{ maxHeight: 'calc(100vh - 160px)' }}>
        {!linksArray.length && isLoadingData.value ? ( // Only if it's the first load (links are empty)
          <div class="flex items-center justify-center h-40">
            <span class="loading loading-spinner loading-lg"></span>
          </div>
        ) : linksArray.length ? (
          <>
            {linksArray.map((link) => {
              let url = link.url;

              if (link.utm) {
                url = addUtmParams(url, link.utm);
              }
              return (
                <LinkBlock
                  id={link.id}
                  key={link.key}
                  urlKey={link.key}
                  url={url}
                  clicks={link.clicks}
                  expirationTime={link.expirationTime}
                  createdAt={link.createdAt}
                  onShowQR={$(() => {
                    qrLink.value = link.key;
                    (document.getElementById(QR_CODE_DIALOG_ID) as any).showModal();
                  })}
                  onDelete={$((id: string) => {
                    idToDelete.value = id;
                    (document.getElementById('delete-modal') as any).showModal();
                  })}
                />
              );
            })}
            {isLoadingData.value && (
              <div class="flex items-center justify-center h-40">
                <span class="loading loading-spinner loading-md"></span>
              </div>
            )}
          </>
        ) : (
          <div class="text-center pt-10">
            <NoData
              title={'Oops! No links found'}
              description={`${filter.value ? 'Try to change your filter or ' : 'Try to '} create a new link`}
            ></NoData>
          </div>
        )}
      </div>
    </>
  );
});

function debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...funcArgs: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function (...args: Parameters<T>) {
    const later = () => {
      timeoutId = null;
      func(...args);
    };

    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(later, wait);
  };
}

export const head: DocumentHead = {
  title: 'Reduced.to | Dashboard',
  meta: [
    {
      name: 'title',
      content: 'Reduced.to | Dashboard - My links',
    },
    {
      name: 'description',
      content: 'Reduced.to | Your links page. see your links, shorten links, and more!',
    },
    {
      property: 'og:type',
      content: 'website',
    },
    {
      property: 'og:url',
      content: 'https://reduced.to/dashboard',
    },
    {
      property: 'og:title',
      content: 'Reduced.to | Dashboard - My links',
    },
    {
      property: 'og:description',
      content: 'Reduced.to | Your links page. see your links, shorten links, and more!',
    },
    {
      property: 'twitter:card',
      content: 'summary',
    },
    {
      property: 'twitter:title',
      content: 'Reduced.to | Dashboard - My links',
    },
    {
      property: 'twitter:description',
      content: 'Reduced.to | Your links page. see your links, shorten links, and more!',
    },
  ],
};
