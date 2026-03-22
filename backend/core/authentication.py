from django.utils import timezone
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed

from .models import UserSession


class SessionAwareJWTAuthentication(JWTAuthentication):
    """
    Enforce server-side session revocation for JWT tokens that carry a shared sid claim.
    Older tokens without sid remain valid until they naturally expire.
    """

    def get_user(self, validated_token):
        user = super().get_user(validated_token)

        session_id = validated_token.get('sid')
        if getattr(user, 'is_locked', False):
            if session_id:
                UserSession.objects.filter(
                    user=user,
                    session_key=str(session_id),
                    is_active=True,
                ).update(is_active=False, logout_at=timezone.now())
            raise AuthenticationFailed('Account is locked.', code='account_locked')

        if not session_id:
            return user

        session = UserSession.objects.filter(
            user=user,
            session_key=str(session_id),
            is_active=True,
        ).first()
        if session is None:
            raise AuthenticationFailed('Session has been revoked or expired.', code='session_revoked')

        UserSession.objects.filter(pk=session.pk).update(last_active=timezone.now())
        return user
