'use client';

import { signOut } from 'next-auth/react';

export const SignOutForm = () => {
  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/' });
  };

  return (
    <form
      className="w-full"
      onSubmit={(e) => {
        e.preventDefault();
        handleSignOut();
      }}
    >
      <button
        type="submit"
        className="w-full text-left px-1 py-0.5 text-red-500"
      >
        Sign out
      </button>
    </form>
  );
};