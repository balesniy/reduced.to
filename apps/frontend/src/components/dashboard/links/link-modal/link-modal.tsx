import { component$, useSignal, $, Signal } from '@builder.io/qwik';
import { Form, globalAction$, zod$ } from '@builder.io/qwik-city';
import { z } from 'zod';
import { ACCESS_COOKIE_NAME, authorizedFetch } from '../../../../shared/auth.service';
import { normalizeUrl } from '../../../../utils';
import { tomorrow } from '../../../../lib/date-utils';
import { SocialMediaPreview } from './social-media-preview/social-media-preview';
import { UNKNOWN_FAVICON } from '../../../temporary-links/utils';
import { useDebouncer } from '../../../../utils/debouncer';
import { LuEye, LuEyeOff, LuDices } from '@qwikest/icons/lucide';
import { sleep } from '@reduced.to/utils';
import { useGetCurrentUser } from '../../../../../../frontend/src/routes/layout';
import { ConditionalWrapper, getRequiredFeatureLevel } from '../../plan-wrapper';

export const LINK_MODAL_ID = 'link-modal';

export interface CreateLinkInput {
  url: string;
  key?: string;
  expirationTime?: string;
  passwordProtection?: string;

  // UTM Builder fields
  utm_ref?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

const CreateLinkInputSchema = z
  .object({
    url: z
      .string({
        required_error: "The url field can't be empty.",
      })
      .min(1, {
        message: "The url field can't be empty.",
      })
      .regex(/^(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?::\d{1,5})?(?:\/\S*)?$/, {
        message: "The url you've entered is not valid",
      }),
    key: z
      .string()
      .max(20, { message: 'The short link cannot exceed 20 characters.' })
      .regex(/^[a-zA-Z0-9-]*$/, {
        message: 'The short link can only contain letters, numbers, and dashes.',
      })
      .optional()
      .refine(
        (val) => {
          if (!val?.length) {
            return true;
          }
          if (val?.length && val?.length < 4) {
            return false;
          }

          return true;
        },
        {
          message: 'The short link must be at least 4 characters long.',
        }
      ),
    expirationTime: z.string().optional(),
    expirationTimeToggle: z.string().optional(),
    passwordProtection: z
      .string()
      .min(6, {
        message: 'Password must be at least 6 characters long.',
      })
      .max(25, {
        message: 'Password must be at most 25 characters long.',
      })
      .optional(),
    passwordProtectionToggle: z.string().optional(),
    utmBuilderToggle: z.string().optional(),
    utm_ref: z.string().max(100, { message: 'Referral (ref) must be at most 100 characters long' }).optional(),
    utm_source: z.string().max(100, { message: 'UTM Source must be at most 100 characters long' }).optional(),
    utm_medium: z.string().max(100, { message: 'UTM Medium must be at most 100 characters long' }).optional(),
    utm_campaign: z.string().max(100, { message: 'UTM Campaign must be at most 100 characters long' }).optional(),
    utm_term: z.string().max(100, { message: 'UTM Term must be at most 100 characters long' }).optional(),
    utm_content: z.string().max(100, { message: 'UTM Content must be at most 100 characters long' }).optional(),
  })
  .refine((data) => !(data.expirationTimeToggle && !data.expirationTime), {
    message: 'Please select a date for your link to expire.',
    path: ['expirationTime'],
  })
  .refine((data) => !(data.passwordProtectionToggle && !data.passwordProtection), {
    message: 'Please enter a password for your link.',
    path: ['passwordProtection'],
  });

type FieldErrors = Partial<Record<keyof CreateLinkInput, string[]>>;

const useCreateLink = globalAction$(
  async (
    {
      url,
      key,
      expirationTime,
      expirationTimeToggle,
      passwordProtection,
      passwordProtectionToggle,
      utmBuilderToggle,
      utm_ref,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
    },
    { fail, cookie }
  ) => {
    const fieldErrors: FieldErrors = {};

    if (expirationTimeToggle && !expirationTime) {
      fieldErrors.expirationTime = ['Please select a date for your link to expire.'];
    }

    if (passwordProtectionToggle && !passwordProtection) {
      fieldErrors.passwordProtection = ['Please enter a password for your link.'];
    }

    if (Object.keys(fieldErrors).length > 0) {
      return fail(400, { fieldErrors });
    }

    const body: CreateLinkInput = {
      url: normalizeUrl(url),
      ...(key && { key: key }),
      ...(expirationTime && { expirationTime: new Date(expirationTime).getTime().toString() }),
      ...(passwordProtection && { password: passwordProtection }),

      // UTM Builder fields
      ...(utmBuilderToggle && utm_ref && { utm_ref }),
      ...(utmBuilderToggle && utm_source && { utm_source }),
      ...(utmBuilderToggle && utm_medium && { utm_medium }),
      ...(utmBuilderToggle && utm_campaign && { utm_campaign }),
      ...(utmBuilderToggle && utm_term && { utm_term }),
      ...(utmBuilderToggle && utm_content && { utm_content }),
    };

    const response: Response = await fetch(`${process.env.API_DOMAIN}/api/v1/shortener`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cookie.get(ACCESS_COOKIE_NAME)?.value}`,
      },
      body: JSON.stringify(body),
    });

    const data: { url: string; key: string; message?: string[] } = await response.json();

    if (response.status !== 201) {
      return fail(500, {
        message: data?.message || 'There was an error creating your link. Please try again.',
      });
    }

    return {
      url,
      key: data.key,
    };
  },
  zod$(CreateLinkInputSchema)
);

export interface LinkModalProps {
  onSubmitHandler: () => void;
}

export const initValues = {
  url: '',
  key: '',
  expirationTime: undefined,
  expirationTimeToggle: undefined,
  passwordProtection: undefined,
  passwordProtectionToggle: undefined,
  utmBuilderToggle: undefined,

  // UTM Builder fields
  utm_ref: undefined,
  utm_source: undefined,
  utm_medium: undefined,
  utm_campaign: undefined,
  utm_term: undefined,
  utm_content: undefined,
};
export const LinkModal = component$(({ onSubmitHandler }: LinkModalProps) => {
  const user = useGetCurrentUser();
  const inputValue = useSignal<CreateLinkInput>({ ...initValues });
  const faviconUrl = useSignal<string | null>(null);
  const previewUrl = useSignal<string | null>(null);

  // Short key input field
  const requiredLevelToCustomShortLink = useSignal<null | string>(getRequiredFeatureLevel(user.value?.plan || 'FREE', 'CUSTOM_SHORT_KEY'));

  // Optional fields
  const isExpirationTimeOpen = useSignal(false);
  const isPasswordProtectionOpen = useSignal(false);
  const showPassword = useSignal(false);
  const isUtmBuilderOpen = useSignal(false);

  const isGeneratingRandomKey = useSignal(false);

  const action = useCreateLink();

  const debounceUrlInput = useDebouncer(
    $((input: string) => {
      faviconUrl.value = input === '' || input === null ? null : `https://www.google.com/s2/favicons?sz=128&domain=${input}`;
      previewUrl.value = input;
    }),
    500
  );

  const generateRandomKey = $(async () => {
    if (requiredLevelToCustomShortLink.value || isGeneratingRandomKey.value) {
      return;
    }

    isGeneratingRandomKey.value = true;
    const response = await authorizedFetch(`${process.env.CLIENTSIDE_API_DOMAIN}/api/v1/shortener/random`, 'GET');
    const key = await response.text();
    await sleep(700);
    inputValue.value = { ...inputValue.value, key };
    isGeneratingRandomKey.value = false;
  });

  const toggleOption = $((signal: Signal<boolean>, resetKeys: (keyof CreateLinkInput)[], resetValue: any = undefined) => {
    signal.value = !signal.value;
    if (!signal.value && resetKeys !== undefined) {
      // Reset field errors
      resetKeys.forEach((key) => {
        inputValue.value[key] = resetValue;
        if (action.value?.fieldErrors![key]) {
          action.value.fieldErrors[key] = [];
        }
      });
    }
  });

  const toggleShowPassword = $(() => {
    showPassword.value = !showPassword.value;
  });

  const clearValues = $(() => {
    inputValue.value = { ...initValues };

    isExpirationTimeOpen.value = false;
    isPasswordProtectionOpen.value = false;
    isUtmBuilderOpen.value = false;
    faviconUrl.value = null;
    previewUrl.value = null;
    showPassword.value = false;

    // Reset the form input just in case
    document.getElementById(LINK_MODAL_ID)?.querySelector('form')?.reset();

    if (action.value?.fieldErrors) {
      Object.keys(action.value.fieldErrors).forEach((key) => {
        action.value!.fieldErrors![key as keyof FieldErrors] = [];
      });
    }
  });

  return (
    <>
      <dialog
        id={LINK_MODAL_ID}
        class="modal fixed inset-0 z-40 m-auto max-h-fit w-full border border-gray-400 dark:border-gray-700 bg-white dark:bg-dark-modal p-0 shadow-xl sm:rounded-2xl max-w-screen-lg block h-auto"
      >
        <div class="grid grid-cols-1 md:grid-cols-2 max-h-[95vh] divide-x divide-gray-100 dark:divide-gray-700 overflow-auto md:overflow-hidden">
          <div class="rounded-l-2xl md:max-h-[95vh] flex flex-col">
            <div class="sticky top-0 z-10 flex h-16 items-center justify-center border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-modal px-5 sm:h-28">
              <img src={faviconUrl.value || UNKNOWN_FAVICON} alt="Favicon" class="mr-4 w-8 h-8" />
              <h2 class="text-lg font-medium">Create a new link</h2>
            </div>
            <Form
              action={action}
              autocomplete="off"
              onSubmitCompleted$={() => {
                if (action.status !== 200) {
                  return;
                }
                clearValues();
                (document.getElementById(LINK_MODAL_ID) as any).close();
                onSubmitHandler();
              }}
              class="flex flex-col h-full overflow-auto"
            >
              <div class="px-4 p-5 flex-grow">
                <div>
                  <label class="label">
                    <span class="label-text">Destination URL</span>
                  </label>
                  <input
                    name="url"
                    type="text"
                    placeholder="https://github.com/origranot/reduced.to"
                    class="input input-bordered w-full"
                    value={inputValue.value.url}
                    onInput$={(ev: InputEvent) => {
                      inputValue.value.url = (ev.target as HTMLInputElement).value;
                      debounceUrlInput(inputValue.value.url);

                      // if the user is typing nad there is no key, generate one
                      if (inputValue.value.url.length > 0 && inputValue.value.key?.length === 0) {
                        generateRandomKey();
                      }
                    }}
                  />
                  {action.value?.fieldErrors?.url?.length ? (
                    <label class="label">
                      <span class={`label-text text-xs text-error text-left`}>{action.value.fieldErrors.url[0]}</span>
                    </label>
                  ) : null}
                </div>

                <div class="pt-4">
                  <div class="flex justify-between">
                    <label class="label">
                      <span class="label-text">Short link</span>
                    </label>
                    {requiredLevelToCustomShortLink.value ? (
                      <ConditionalWrapper access="CUSTOM_SHORT_KEY" cs="mr-[1.7rem]" />
                    ) : (
                      <div class="tooltip tooltip-left text-sm" data-tip="Generate a random key">
                        <div class="mt-2 mr-1 text-gray-500">
                          {isGeneratingRandomKey.value ? (
                            <span class="loading loading-spinner-small h-5 w-5" />
                          ) : (
                            <LuDices class={`hover:text-gray-700 cursor-pointer h-5 w-5`} onClick$={generateRandomKey} />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div class="join w-full">
                    <select class={`select select-bordered join-item ${requiredLevelToCustomShortLink.value ? 'select-disabled' : ''}`}>
                      <option selected>reduced.to</option>
                    </select>
                    <div class="w-full">
                      <input
                        name="key"
                        type="text"
                        class={`input input-bordered join-item w-full ${requiredLevelToCustomShortLink.value ? 'input-disabled' : ''}`}
                        placeholder="git"
                        value={inputValue.value.key}
                        onInput$={(ev: InputEvent) => {
                          inputValue.value.key = (ev.target as HTMLInputElement).value;
                        }}
                      />
                    </div>
                  </div>
                  {action.value?.fieldErrors?.key?.length ? (
                    <label class="label">
                      <span class={`label-text text-xs text-error text-left`}>{action.value.fieldErrors.key[0]}</span>
                    </label>
                  ) : null}
                </div>
                {action.value?.failed && action.value.message && (
                  <label class="label">
                    <span class={`label-text text-xs text-error text-left`}>{action.value.message}</span>
                  </label>
                )}
                <div class="divider pt-4">Optional</div>
                <div class="flex flex-col">
                  <div class="form-control">
                    <label class="cursor-pointer label">
                      <span class="label-text">Expiration date</span>
                      <ConditionalWrapper access="LINK_EXPIRATION">
                        <input
                          type="checkbox"
                          checked={isExpirationTimeOpen.value}
                          onChange$={() => toggleOption(isExpirationTimeOpen, ['expirationTime'], undefined)}
                          name="expirationTimeToggle"
                          class="toggle toggle-primary"
                        />
                      </ConditionalWrapper>
                    </label>
                    {isExpirationTimeOpen.value && (
                      <input
                        name="expirationTime"
                        type="date"
                        min={tomorrow().toISOString().split('T')[0]}
                        class="input input-bordered w-full"
                        value={inputValue.value.expirationTime}
                        onInput$={(ev: InputEvent) => {
                          inputValue.value.expirationTime = (ev.target as HTMLInputElement).value;
                        }}
                      />
                    )}
                    {action.value?.fieldErrors?.expirationTime?.length ? (
                      <label class="label">
                        <span class={`label-text text-xs text-error text-left`}>{action.value.fieldErrors.expirationTime[0]}</span>
                      </label>
                    ) : null}
                  </div>
                  <div class="form-control">
                    <label class="cursor-pointer label">
                      <span class="label-text">Password protection</span>
                      <ConditionalWrapper access="PASSWORD_PROTECTION">
                        <input
                          type="checkbox"
                          checked={isPasswordProtectionOpen.value}
                          onChange$={() => {
                            toggleOption(isPasswordProtectionOpen, ['passwordProtection'], undefined);
                            if (!isPasswordProtectionOpen.value) {
                              showPassword.value = false;
                            }
                          }}
                          name="passwordProtectionToggle"
                          class="toggle toggle-primary"
                        />
                      </ConditionalWrapper>
                    </label>
                    {isPasswordProtectionOpen.value && (
                      <label class="input input-bordered flex items-center gap-2">
                        <input
                          name="passwordProtection"
                          placeholder="Very secured password..."
                          type={showPassword.value ? 'text' : 'password'}
                          class="grow dark:bg-slate-900"
                          value={inputValue.value.passwordProtection}
                          onInput$={(ev: InputEvent) => {
                            inputValue.value.passwordProtection = (ev.target as HTMLInputElement).value;
                          }}
                        />
                        {showPassword.value ? (
                          <LuEye class="cursor-pointer text-gray-500 hover:text-gray-700" onClick$={toggleShowPassword} />
                        ) : (
                          <LuEyeOff class="cursor-pointer text-gray-500 hover:text-gray-700" onClick$={toggleShowPassword} />
                        )}
                      </label>
                    )}
                    {action.value?.fieldErrors?.passwordProtection?.length ? (
                      <label class="label">
                        <span class={`label-text text-xs text-error text-left`}>{action.value.fieldErrors.passwordProtection[0]}</span>
                      </label>
                    ) : null}
                  </div>
                  {/** Add here UTM builder  */}
                  <div class="form-control">
                    <label class="cursor-pointer label">
                      <span class="label-text">UTM Builder</span>
                      <ConditionalWrapper access="UTM_BUILDER">
                        <input
                          type="checkbox"
                          checked={isUtmBuilderOpen.value}
                          onChange$={() => {
                            toggleOption(
                              isUtmBuilderOpen,
                              ['utm_ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'],
                              undefined
                            );
                          }}
                          name="utmBuilderToggle"
                          class="toggle toggle-primary"
                        />
                      </ConditionalWrapper>
                    </label>
                    {isUtmBuilderOpen.value && (
                      <div class="px-4">
                        <div class="sm:flex block gap-4">
                          <label class="form-control w-full">
                            <div class="label">
                              <span class="label-text text-xs text-gray-500">Referral (ref)</span>
                            </div>
                            <input
                              type="text"
                              value={inputValue.value.utm_ref}
                              onInput$={(ev: InputEvent) => {
                                inputValue.value.utm_ref = (ev.target as HTMLInputElement).value;
                              }}
                              placeholder="reduced.to"
                              name="utm_ref"
                              class="input input-bordered w-full"
                            />
                            {action.value?.fieldErrors?.utm_ref?.length ? (
                              <label class="label">
                                <span class={`label-text text-xs text-error text-left`}>{action.value.fieldErrors.utm_ref[0]}</span>
                              </label>
                            ) : null}
                          </label>
                          <label class="form-control w-full">
                            <div class="label">
                              <span class="label-text text-xs text-gray-500">UTM Source</span>
                            </div>
                            <input
                              type="text"
                              value={inputValue.value.utm_source}
                              onInput$={(ev: InputEvent) => {
                                inputValue.value.utm_source = (ev.target as HTMLInputElement).value;
                              }}
                              placeholder="facebook, instagram"
                              name="utm_source"
                              class="input input-bordered w-full"
                            />
                            {action.value?.fieldErrors?.utm_source?.length ? (
                              <label class="label">
                                <span class={`label-text text-xs text-error text-left`}>{action.value.fieldErrors.utm_source[0]}</span>
                              </label>
                            ) : null}
                          </label>
                        </div>
                        <div class="sm:flex block gap-4">
                          <label class="form-control w-full">
                            <div class="label">
                              <span class="label-text text-xs text-gray-500">UTM Medium</span>
                            </div>
                            <input
                              type="text"
                              value={inputValue.value.utm_medium}
                              onInput$={(ev: InputEvent) => {
                                inputValue.value.utm_medium = (ev.target as HTMLInputElement).value;
                              }}
                              placeholder="social, email"
                              name="utm_medium"
                              class="input input-bordered w-full"
                            />
                            {action.value?.fieldErrors?.utm_medium?.length ? (
                              <label class="label">
                                <span class={`label-text text-xs text-error text-left`}>{action.value.fieldErrors.utm_medium[0]}</span>
                              </label>
                            ) : null}
                          </label>
                          <label class="form-control w-full">
                            <div class="label">
                              <span class="label-text text-xs text-gray-500">UTM Campaign</span>
                            </div>
                            <input
                              type="text"
                              value={inputValue.value.utm_campaign}
                              onInput$={(ev: InputEvent) => {
                                inputValue.value.utm_campaign = (ev.target as HTMLInputElement).value;
                              }}
                              placeholder="christmas_sale"
                              name="utm_campaign"
                              class="input input-bordered w-full"
                            />
                            {action.value?.fieldErrors?.utm_campaign?.length ? (
                              <label class="label">
                                <span class={`label-text text-xs text-error text-left`}>{action.value.fieldErrors.utm_campaign[0]}</span>
                              </label>
                            ) : null}
                          </label>
                        </div>
                        <div class="sm:flex block gap-4">
                          <label class="form-control w-full">
                            <div class="label">
                              <span class="label-text text-xs text-gray-500">UTM Term</span>
                            </div>
                            <input
                              type="text"
                              value={inputValue.value.utm_term}
                              onInput$={(ev: InputEvent) => {
                                inputValue.value.utm_term = (ev.target as HTMLInputElement).value;
                              }}
                              placeholder="green_shirt"
                              name="utm_term"
                              class="input input-bordered w-full"
                            />
                            {action.value?.fieldErrors?.utm_term?.length ? (
                              <label class="label">
                                <span class={`label-text text-xs text-error text-left`}>{action.value.fieldErrors.utm_term[0]}</span>
                              </label>
                            ) : null}
                          </label>
                          <label class="form-control w-full">
                            <div class="label">
                              <span class="label-text text-xs text-gray-500">UTM Content</span>
                            </div>
                            <input
                              type="text"
                              value={inputValue.value.utm_content}
                              onInput$={(ev: InputEvent) => {
                                inputValue.value.utm_content = (ev.target as HTMLInputElement).value;
                              }}
                              placeholder="clothing"
                              name="utm_content"
                              class="input input-bordered w-full"
                            />
                            {action.value?.fieldErrors?.utm_content?.length ? (
                              <label class="label">
                                <span class={`label-text text-xs text-error text-left`}>{action.value.fieldErrors.utm_content[0]}</span>
                              </label>
                            ) : null}
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="submit"
                class={`btn btn-primary md:w-full w-1/2 no-animation md:rounded-none m-auto mb-5 md:mb-0 sm:sticky bottom-0 left-0 sm:mt-0 mt-5 ${
                  inputValue.value.url.length === 0 ? '!cursor-not-allowed btn-disabled !bg-opacity-100 !bg-gray-300 dark:!bg-gray-700' : ''
                }`}
              >
                {action.isRunning ? <span class="loading loading-spinner-small"></span> : 'Create'}
              </button>
            </Form>
          </div>
          <div class="rounded-r-2xl md:max-h-[95vh] flex flex-col">
            <div class="sticky top-0 z-10 flex !h-14 min-h-14 items-center justify-center border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-modal px-5 sm:h-24 sm:min-h-24">
              <h2 class="text-lg font-medium">Social Previews</h2>
            </div>
            <div class="items-center justify-center space-y-4 bg-gray-100 dark:bg-slate-900 p-5 overflow-auto">
              <SocialMediaPreview url={previewUrl} />
            </div>
          </div>
        </div>
        <button
          type="button"
          class="absolute right-0 top-0 z-20 m-3 rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none active:bg-gray-200 dark:active:bg-gray-900 md:block"
          onClick$={() => {
            (document.getElementById(LINK_MODAL_ID) as any).close();
            clearValues();
          }}
        >
          <svg
            fill="none"
            shape-rendering="geometricPrecision"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.5"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            class="h-5 w-5"
          >
            <path d="M18 6L6 18"></path>
            <path d="M6 6l12 12"></path>
          </svg>
        </button>
      </dialog>
    </>
  );
});
