import { CatalogPage } from './CatalogPage'

/**
 * Классический маршрут «Модпаки» теперь открывает общий каталог
 * с предвыбранным типом контента.
 */
export function ModpacksPage() {
  return <CatalogPage initialType="modpack" />
}
