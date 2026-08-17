import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { config } from '../../core/runtime-config';
import {
  Facets,
  FundQuery,
  NavPoint,
  SchemeDetail,
  SchemeListResponse,
  Stats,
} from './fund.models';

@Injectable({ providedIn: 'root' })
export class FundService {
  private readonly http = inject(HttpClient);
  private readonly base = `${config.apiUrl}/funds`;

  list(query: FundQuery): Observable<SchemeListResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return this.http.get<SchemeListResponse>(this.base, { params });
  }

  detail(code: number): Observable<SchemeDetail> {
    return this.http.get<SchemeDetail>(`${this.base}/${code}`);
  }

  navHistory(code: number, range = 'all'): Observable<NavPoint[]> {
    const params = new HttpParams().set('range', range);
    return this.http.get<NavPoint[]>(`${this.base}/${code}/nav`, { params });
  }

  facets(): Observable<Facets> {
    return this.http.get<Facets>(`${this.base}/facets`);
  }

  stats(): Observable<Stats> {
    return this.http.get<Stats>(`${this.base}/stats`);
  }
}
