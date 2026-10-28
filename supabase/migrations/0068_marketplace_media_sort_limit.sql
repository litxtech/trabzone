-- 0014'teki 0..9 sıralama sınırı, 12 fotoğraflı ilan oluşturmayı engelliyordu.
-- İlan formu 12 medyaya izin veriyor; RPC de 20 medyaya kadar kayıt kabul ediyor.
-- Sıralama alanını 0..99 aralığına genişletiyoruz.

alter table public.marketplace_listing_images
  drop constraint if exists marketplace_images_sort_check;

alter table public.marketplace_listing_images
  add constraint marketplace_images_sort_check check (sort_order between 0 and 99);

comment on constraint marketplace_images_sort_check on public.marketplace_listing_images is
  'İlan galerisinde en fazla 99 sıralı medya; form ve RPC üst sınırı ayrıca uygular.';
