"""Product and master-data API route registration."""

from core.router_utils import register_routes
from products.views import (
    OperationViewSet,
    ProductBoxTypeViewSet,
    ProductCategoryViewSet,
    ProductUnitViewSet,
    ProductViewSet,
    ProductWaveViewSet,
)


def register_product_routes(router) -> None:
    register_routes(
        router,
        [
            ('products/categories', ProductCategoryViewSet, 'productcategory'),
            ('products/units', ProductUnitViewSet, 'productunit'),
            ('products/waves', ProductWaveViewSet, 'wave'),
            ('products/box-types', ProductBoxTypeViewSet, 'boxtype'),
            ('products/operations', OperationViewSet, 'operation'),
            ('products/products', ProductViewSet, 'product'),
        ],
    )
