import type { CardCatalog } from '../types/card';
import { getOpenRiftCatalog } from './card-providers/openrift';

/** UI가 데이터 제공처에 직접 의존하지 않도록 둔 조회 인터페이스입니다. */
export function loadCards(options: { force?: boolean } = {}): Promise<CardCatalog> {
  return getOpenRiftCatalog(options);
}
