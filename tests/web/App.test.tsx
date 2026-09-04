import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/web/App';

describe('App', () => {
  it('renders the public enrollment page', () => {
    render(<App />);

    expect(screen.getByText('Findly')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Encuentra tu momento.' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre completo')).toBeInTheDocument();
    expect(screen.getByLabelText('Email para tu galería')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });
});
