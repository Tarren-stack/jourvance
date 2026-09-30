import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X, ShoppingBag, Search, Sparkles, Check, ChevronRight,
  RefreshCw, ExternalLink, AlertCircle, Tag, Layers
} from 'lucide-react';
import type { Workspace, ShopifyProduct, ShopifyProductVariant } from '../../types/journey';
import { fetchShopifyProducts } from '../../lib/shopifyClient';
import { pickerCatalog, NO_STORE_CONNECTED } from '../../lib/productPickerCatalog';
import { useDialogFocus, useFieldIds } from '../../lib/a11yHooks';

export interface SelectedProductPayload {
  product: ShopifyProduct;
  variant: ShopifyProductVariant;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectProduct: (payload: SelectedProductPayload) => void;
  workspace?: Workspace | null;
  onOpenShopifyConnect?: () => void;
  title?: string;
  subtitle?: string;
  selectedVariantId?: string;
}

export const ShopifyProductPickerModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onSelectProduct,
  workspace,
  onOpenShopifyConnect,
  title = 'Select Shopify Product',
  subtitle = 'Choose a product or variant from your catalog to connect directly to 1-click checkout.',
  selectedVariantId
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [liveProducts, setLiveProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);

  const isConnected = workspace?.shopifyConfig?.status === 'connected' && Boolean(workspace?.shopifyConfig?.storeDomain);
  const storeDomain = workspace?.shopifyConfig?.storeDomain || '';
  const noStore = !(isConnected && Boolean(workspace?.id));

  // Only the connected store's own products can be picked. A connected store whose read fails or
  // comes back empty gets an error and Try again, and a workspace with no store gets a note and
  // nothing to pick: a sample catalog offered in either case wrote an invented product, price and
  // variant id into the merchant's page or upsell, and the page published them (C25, R14).
  const loadProducts = async () => {
    const apply = (res: Parameters<typeof pickerCatalog>[1]) => {
      const next = pickerCatalog(!noStore, res);
      setLiveProducts(next.products);
      setLoadError(next.mode === 'error' ? next.message : '');
    };
    if (noStore || !workspace?.id) {
      apply(null);
      return;
    }

    setLoading(true);
    setLoadError('');
    try {
      apply(await fetchShopifyProducts(workspace.id));
    } catch {
      apply(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadProducts();
      setSearchQuery('');
    }
  }, [isOpen, workspace?.id, isConnected]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return liveProducts;
    return liveProducts.filter(p => {
      const matchTitle = (p.title || '').toLowerCase().includes(q);
      const matchDesc = (p.description || '').toLowerCase().includes(q);
      const matchVariants = (p.variants || []).some(
        v => (v.title || '').toLowerCase().includes(q) || (v.sku || '').toLowerCase().includes(q)
      );
      return matchTitle || matchDesc || matchVariants;
    });
  }, [liveProducts, searchQuery]);

  // A modal on the shared dialog stack: Escape closes the picker and leaves the step panel around
  // it open, Tab stays inside, and focus goes back to the button that opened it.
  const panelRef = useDialogFocus<HTMLDivElement>(isOpen, onClose, { modal: true });
  const fid = useFieldIds();

  // Try again unmounts itself while the read runs, so focus would fall to the page. Put it back on
  // Try again if the read failed again, or on the search box once products are listed.
  const retryRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [retried, setRetried] = useState(0);
  useEffect(() => {
    const panel = panelRef.current;
    if (!retried || !panel || panel.contains(document.activeElement)) return;
    (retryRef.current ?? searchRef.current)?.focus();
  }, [retried]);
  const retry = async () => {
    await loadProducts();
    setRetried(n => n + 1);
  };

  if (!isOpen) return null;

  const handlePick = (product: ShopifyProduct, variant: ShopifyProductVariant) => {
    onSelectProduct({ product, variant });
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(5, 5, 10, 0.82)',
        backdropFilter: 'blur(10px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        animation: 'fadeIn 0.2s ease-out'
      }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={fid('title')}
        style={{
          width: '100%',
          maxWidth: '720px',
          maxHeight: '88vh',
          backgroundColor: 'rgba(15, 23, 42, 0.98)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '16px',
          boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.8), 0 0 40px rgba(244, 114, 182, 0.12)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '16px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '10px',
                backgroundColor: 'rgba(244, 114, 182, 0.15)',
                border: '1px solid rgba(244, 114, 182, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#f472b6'
              }}
            >
              <ShoppingBag size={20} />
            </div>
            <div>
              <h3 id={fid('title')} tabIndex={-1} data-dialog-start style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#FFFFFF', letterSpacing: '-0.01em' }}>
                {title}
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94A3B8', lineHeight: 1.4 }}>
                {subtitle}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'rgba(255, 255, 255, 0.06)',
              border: 'none',
              borderRadius: '8px',
              padding: '8px',
              color: '#94A3B8',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease'
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Store Connection Status Banner */}
        <div
          style={{
            padding: '10px 24px',
            backgroundColor: !noStore && !loadError ? 'rgba(16, 185, 129, 0.08)' : 'rgba(244, 114, 182, 0.08)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                backgroundColor: !noStore && !loadError ? '#10B981' : '#F472B6'
              }}
            />
            {!noStore && loadError ? (
              <span style={{ color: '#F472B6', fontWeight: 600 }}>
                Connected store: <strong style={{ color: '#FFFFFF' }}>{storeDomain}</strong> <span style={{ color: '#94A3B8', fontWeight: 500 }}>(products unavailable)</span>
              </span>
            ) : !noStore ? (
              <span style={{ color: '#10B981', fontWeight: 600 }}>
                Live Catalog: <strong style={{ color: '#FFFFFF' }}>{storeDomain}</strong> ({liveProducts.length} items synced)
              </span>
            ) : (
              <span style={{ color: '#F472B6', fontWeight: 500 }}>
                No store connected
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {!noStore && (
              <button
                type="button"
                onClick={loadProducts}
                disabled={loading}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#94A3B8',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                Refresh
              </button>
            )}
            {noStore && onOpenShopifyConnect && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenShopifyConnect();
                }}
                style={{
                  background: 'rgba(244, 114, 182, 0.2)',
                  border: '1px solid rgba(244, 114, 182, 0.4)',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  color: '#F472B6',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Connect Store
              </button>
            )}
          </div>
        </div>

        {/* Search Bar: nothing to search until a store is connected */}
        {!noStore && (
        <div style={{ padding: '16px 24px 12px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              backgroundColor: 'rgba(0, 0, 0, 0.45)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              borderRadius: '10px',
              padding: '10px 14px'
            }}
          >
            <Search size={16} color="#94A3B8" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search by product name, shade, volume, or SKU..."
              aria-label="Search products"
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '13px',
                outline: 'none'
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748B',
                  cursor: 'pointer',
                  padding: '2px'
                }}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        )}

        {/* Product Cards Container */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 24px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          {noStore ? (
            <div
              style={{
                padding: '40px 20px',
                textAlign: 'center',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '12px',
                border: '1px dashed rgba(255, 255, 255, 0.1)'
              }}
            >
              <ShoppingBag size={24} style={{ color: '#94A3B8', margin: '0 auto 8px' }} />
              <div style={{ color: '#FFFFFF', fontSize: '13px', fontWeight: 600 }}>{NO_STORE_CONNECTED}</div>
            </div>
          ) : loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>
              <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 12px', color: '#F472B6' }} />
              <div style={{ fontSize: '13px', fontWeight: 600 }}>Syncing Shopify catalog...</div>
            </div>
          ) : loadError ? (
            <div
              role="alert"
              style={{
                padding: '40px 20px',
                textAlign: 'center',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '12px',
                border: '1px dashed rgba(255, 255, 255, 0.1)'
              }}
            >
              <AlertCircle size={24} style={{ color: '#F472B6', margin: '0 auto 8px' }} />
              <div style={{ color: '#FFFFFF', fontSize: '13px', fontWeight: 600 }}>{loadError}</div>
              <button
                ref={retryRef}
                type="button"
                onClick={retry}
                style={{
                  marginTop: '12px',
                  background: 'rgba(244, 114, 182, 0.2)',
                  border: '1px solid rgba(244, 114, 182, 0.4)',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  color: '#F472B6',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Try again
              </button>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div
              style={{
                padding: '40px 20px',
                textAlign: 'center',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '12px',
                border: '1px dashed rgba(255, 255, 255, 0.1)'
              }}
            >
              <AlertCircle size={24} style={{ color: '#94A3B8', margin: '0 auto 8px' }} />
              <div style={{ color: '#FFFFFF', fontSize: '13px', fontWeight: 600 }}>No matching products found</div>
              <div style={{ color: '#64748B', fontSize: '12px', marginTop: '4px' }}>
                Try searching for a different keyword or shade.
              </div>
            </div>
          ) : (
            filteredProducts.map(product => {
              const hasMultipleVariants = Array.isArray(product.variants) && product.variants.length > 1;
              const isSelectedProduct = selectedProductId === product.id;
              const defaultVariant = product.variants?.[0] || {
                id: product.id,
                title: 'Default',
                price: product.price,
                available: true
              };

              return (
                <div
                  key={product.id}
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '12px',
                    padding: '14px',
                    transition: 'all 0.15s ease',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    {/* Thumbnail */}
                    <div
                      style={{
                        width: '56px',
                        height: '56px',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(0, 0, 0, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        overflow: 'hidden',
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      {product.imageUrl ? (
                        <img
                          src={product.imageUrl}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <ShoppingBag size={22} color="#64748B" />
                      )}
                    </div>

                    {/* Product Details */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <h4
                          style={{
                            margin: 0,
                            fontSize: '14px',
                            fontWeight: 600,
                            color: '#FFFFFF',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          {product.title}
                        </h4>
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: '#10B981',
                            backgroundColor: 'rgba(16, 185, 129, 0.12)',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            border: '1px solid rgba(16, 185, 129, 0.25)'
                          }}
                        >
                          {product.price}
                        </span>
                        {hasMultipleVariants && (
                          <span
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                              color: '#A855F7',
                              backgroundColor: 'rgba(168, 85, 247, 0.12)',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              border: '1px solid rgba(168, 85, 247, 0.25)'
                            }}
                          >
                            {product.variants.length} Variants
                          </span>
                        )}
                      </div>

                      {product.description && (
                        <p
                          style={{
                            margin: '4px 0 0',
                            fontSize: '11px',
                            color: '#94A3B8',
                            lineHeight: 1.4,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden'
                          }}
                        >
                          {product.description}
                        </p>
                      )}
                    </div>

                    {/* Direct Single Variant Pick Button */}
                    {!hasMultipleVariants && (
                      <button
                        type="button"
                        onClick={() => handlePick(product, defaultVariant)}
                        style={{
                          backgroundColor: selectedVariantId === defaultVariant.id ? '#10B981' : 'rgba(244, 114, 182, 0.15)',
                          border: selectedVariantId === defaultVariant.id ? '1px solid #10B981' : '1px solid rgba(244, 114, 182, 0.35)',
                          color: selectedVariantId === defaultVariant.id ? '#FFFFFF' : '#F472B6',
                          borderRadius: '8px',
                          padding: '8px 14px',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          flexShrink: 0,
                          transition: 'all 0.15s ease'
                        }}
                      >
                        {selectedVariantId === defaultVariant.id ? (
                          <>
                            <Check size={14} />
                            Selected
                          </>
                        ) : (
                          <>
                            Select Product
                            <ChevronRight size={14} />
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Multi-Variant Pills Selector */}
                  {hasMultipleVariants && (
                    <div
                      style={{
                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                        borderRadius: '8px',
                        padding: '10px 12px',
                        border: '1px solid rgba(255, 255, 255, 0.05)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}
                    >
                      <div style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Select Specific Variant to Connect:
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '6px' }}>
                        {product.variants.map(variant => {
                          const isVarSelected = selectedVariantId === variant.id;
                          return (
                            <button
                              key={variant.id}
                              type="button"
                              onClick={() => handlePick(product, variant)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '8px 10px',
                                borderRadius: '6px',
                                backgroundColor: isVarSelected ? 'rgba(16, 185, 129, 0.18)' : 'rgba(255, 255, 255, 0.04)',
                                border: isVarSelected ? '1px solid #10B981' : '1px solid rgba(255, 255, 255, 0.08)',
                                color: isVarSelected ? '#34D399' : '#CBD5E1',
                                fontSize: '11px',
                                textAlign: 'left',
                                cursor: 'pointer',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <div style={{ minWidth: 0, paddingRight: '8px' }}>
                                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {variant.title}
                                </div>
                                {variant.sku && (
                                  <div style={{ fontSize: '11px', color: '#64748B', fontFamily: 'monospace' }}>
                                    SKU: {variant.sku}
                                  </div>
                                )}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                <span style={{ fontWeight: 700, color: isVarSelected ? '#34D399' : '#F472B6' }}>
                                  {variant.price}
                                </span>
                                {isVarSelected && <Check size={12} color="#10B981" />}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '12px 24px',
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: '#64748B'
          }}
        >
          <span>
            Selecting a product automatically maps the <strong>Shopify Variant ID</strong> to 1-click checkout.
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              borderRadius: '6px',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              backgroundColor: 'transparent',
              color: '#CBD5E1',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
