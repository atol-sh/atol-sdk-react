import { type ButtonHTMLAttributes, type PropsWithChildren } from 'react'
import { useAtol } from '../hooks/use-atol'

type ButtonProps = PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>

/**
 * Login button. Redirects to Atol login when clicked.
 *
 * ```tsx
 * <LoginButton>Sign in</LoginButton>
 * ```
 */
export function LoginButton({ children, onClick, ...props }: ButtonProps) {
  const { login } = useAtol()

  return (
    <button
      {...props}
      onClick={(e) => {
        onClick?.(e)
        void login()
      }}
    >
      {children ?? 'Sign in'}
    </button>
  )
}

/**
 * Logout button. Signs out and redirects to the redirect URI.
 *
 * ```tsx
 * <LogoutButton>Sign out</LogoutButton>
 * ```
 */
export function LogoutButton({ children, onClick, ...props }: ButtonProps) {
  const { logout } = useAtol()

  return (
    <button
      {...props}
      onClick={(e) => {
        onClick?.(e)
        logout()
      }}
    >
      {children ?? 'Sign out'}
    </button>
  )
}
