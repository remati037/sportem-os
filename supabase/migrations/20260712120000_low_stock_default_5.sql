-- Prag niskog stanja: ujednači SVE postojeće varijante na 5 komada.
-- Default kolone je već 5 (init šema); ovo normalizuje redove koji su kroz
-- CSV uvoz ili ručni unos dobili drugu vrednost. Ne dira snapshot/finansije.
update public.product_variants
set low_stock_threshold = 5
where low_stock_threshold <> 5;
