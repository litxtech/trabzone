/**
 * Anlık gelişme web/derin bağlantı girişi.
 *
 * Kanonik içerik kimliği gönderi kimliğidir; bu ekran aynı detay kartını
 * açar. `/p/gelisme/{id}` paylaşım adresi ve `trabzone://live-news/{id}`
 * derin bağlantısı buraya yönlenir.
 */
export { default } from '../post/[id]';
