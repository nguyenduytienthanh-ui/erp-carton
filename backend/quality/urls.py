from rest_framework.routers import SimpleRouter

from .views import (
    QualityDefectCatalogViewSet,
    QualityImageArtifactViewSet,
    QualityImageRetentionPolicyViewSet,
    QualityInspectionDefectViewSet,
    QualityInspectionViewSet,
    QualityStorageCleanupViewSet,
    QualityStorageSettingsViewSet,
    VisionInspectionJobViewSet,
)


router = SimpleRouter()
router.register(r'printing-inspections', QualityInspectionViewSet, basename='quality-printing-inspection')
router.register(r'defect-catalog', QualityDefectCatalogViewSet, basename='quality-defect-catalog')
router.register(r'inspection-defects', QualityInspectionDefectViewSet, basename='quality-inspection-defect')
router.register(r'vision-jobs', VisionInspectionJobViewSet, basename='quality-vision-job')
router.register(r'image-artifacts', QualityImageArtifactViewSet, basename='quality-image-artifact')
router.register(r'image-retention-policies', QualityImageRetentionPolicyViewSet, basename='quality-image-retention-policy')
router.register(r'storage-settings', QualityStorageSettingsViewSet, basename='quality-storage-settings')
router.register(r'storage-cleanup', QualityStorageCleanupViewSet, basename='quality-storage-cleanup')

urlpatterns = router.urls
